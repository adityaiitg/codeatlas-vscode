import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CodeAtlasCli } from "../cliRunner";
import { GraphData } from "../types";

export class GraphWebviewPanel {
  public static currentPanel: GraphWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static async createOrShow(
    extensionUri: vscode.Uri,
    cli: CodeAtlasCli
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GraphWebviewPanel.currentPanel) {
      GraphWebviewPanel.currentPanel._panel.reveal(column);
      await GraphWebviewPanel.currentPanel.loadGraphData(cli);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "codeatlasGraphViewer",
      "CodeAtlas Knowledge Graph",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    GraphWebviewPanel.currentPanel = new GraphWebviewPanel(
      panel,
      extensionUri,
      cli
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    cli: CodeAtlasCli
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "openFile":
            if (message.filePath) {
              const fullPath = path.isAbsolute(message.filePath)
                ? message.filePath
                : path.join(cli.getWorkspaceRoot(), message.filePath);
              if (fs.existsSync(fullPath)) {
                const doc = await vscode.workspace.openTextDocument(fullPath);
                const line = Math.max(0, (message.line || 1) - 1);
                await vscode.window.showTextDocument(doc, {
                  selection: new vscode.Range(line, 0, line, 0),
                });
              } else {
                vscode.window.showWarningMessage(
                  `File not found: ${message.filePath}`
                );
              }
            }
            break;

          case "analyzeImpact":
            if (message.symbol) {
              vscode.commands.executeCommand(
                "codeatlas.impact",
                message.symbol
              );
            }
            break;

          case "searchSymbol":
            if (message.query) {
              vscode.commands.executeCommand("codeatlas.search", message.query);
            }
            break;

          case "refreshGraph":
            await this.loadGraphData(cli);
            break;
        }
      },
      null,
      this._disposables
    );

    this.loadGraphData(cli);
  }

  public async loadGraphData(cli: CodeAtlasCli): Promise<void> {
    this._panel.webview.html = this._getHtmlForLoading();

    try {
      const graphData = await cli.exportGraph();
      if (!graphData || graphData.nodes.length === 0) {
        // Fallback: construct lightweight graph from status or direct DB scan
        this._panel.webview.html = this._getHtmlForEmpty();
        return;
      }
      this._panel.webview.html = this._getHtmlForWebview(graphData);
    } catch {
      this._panel.webview.html = this._getHtmlForEmpty();
    }
  }

  private _getHtmlForLoading(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          font-family: var(--vscode-font-family);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .spinner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
      </style>
    </head>
    <body>
      <div class="spinner">
        <h2>Loading CodeAtlas Knowledge Graph...</h2>
        <p>Analyzing symbol nodes and call graph edges</p>
      </div>
    </body>
    </html>`;
  }

  private _getHtmlForEmpty(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          font-family: var(--vscode-font-family);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        .box {
          max-width: 420px;
          padding: 24px;
        }
        button {
          margin-top: 16px;
          padding: 8px 16px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>No Knowledge Graph Data Found</h2>
        <p>The workspace may not be indexed yet, or contains no resolved symbols.</p>
        <button onclick="refresh()">Re-index Workspace</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        function refresh() {
          vscode.postMessage({ command: 'refreshGraph' });
        }
      </script>
    </body>
    </html>`;
  }

  private _getHtmlForWebview(graphData: GraphData): string {
    const rawJson = JSON.stringify(graphData);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CodeAtlas Knowledge Graph</title>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <style>
        :root {
          --bg: var(--vscode-editor-background, #0d1117);
          --card-bg: var(--vscode-sideBar-background, #161b22);
          --border: var(--vscode-panel-border, #30363d);
          --text: var(--vscode-editor-foreground, #c9d1d9);
          --text-dim: var(--vscode-descriptionForeground, #8b949e);
          --cyan: #58a6ff;
          --green: #3fb950;
          --yellow: #d29922;
          --purple: #bc8cff;
          --red: #f85149;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--vscode-font-family, -apple-system, sans-serif);
          overflow: hidden;
          display: flex;
          height: 100vh;
        }
        #sidebar {
          width: 340px;
          background: var(--card-bg);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          z-index: 10;
        }
        .header {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .header h1 { font-size: 16px; font-weight: 600; }
        .search-box {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
        }
        .search-input {
          width: 100%;
          padding: 6px 10px;
          background: var(--vscode-input-background, #0d1117);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--vscode-input-foreground, #fff);
          font-size: 13px;
          outline: none;
        }
        .stats-bar {
          padding: 8px 16px;
          background: rgba(0,0,0,0.15);
          border-bottom: 1px solid var(--border);
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: var(--text-dim);
        }
        #details {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
        }
        .btn {
          display: inline-block;
          margin-top: 10px;
          margin-right: 8px;
          padding: 6px 12px;
          background: var(--vscode-button-background, #1f6feb);
          color: var(--vscode-button-foreground, #fff);
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
        }
        .btn:hover {
          background: var(--vscode-button-hoverBackground, #388bfd);
        }
        .badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }
        .badge-class { background: #1f3b5c; color: var(--cyan); }
        .badge-function { background: #1c3d27; color: var(--green); }
        .badge-module { background: #3d3118; color: var(--yellow); }
        .badge-call { background: #3c245c; color: var(--purple); }
        #graph-container {
          flex: 1;
          position: relative;
          background: var(--bg);
        }
        svg { width: 100%; height: 100%; }
        .node circle {
          cursor: pointer;
          stroke-width: 2px;
          transition: r 0.2s;
        }
        .node:hover circle { r: 10px; stroke: #fff; }
        .node text {
          font-size: 10px;
          fill: var(--text-dim);
          pointer-events: none;
        }
        .link {
          stroke: #30363d;
          stroke-opacity: 0.6;
          stroke-width: 1.2px;
        }
        .link.highlight {
          stroke: var(--cyan);
          stroke-opacity: 1;
          stroke-width: 2.2px;
        }
      </style>
    </head>
    <body>
      <div id="sidebar">
        <div class="header">
          <h1>🗺️ CodeAtlas Graph</h1>
          <button class="btn" style="margin:0; padding:4px 8px;" onclick="resetZoom()">Reset</button>
        </div>
        <div class="search-box">
          <input type="text" id="nodeSearch" class="search-input" placeholder="Filter symbol or module..." oninput="filterNodes(this.value)">
        </div>
        <div class="stats-bar">
          <span id="nodeCount">0 nodes</span>
          <span id="edgeCount">0 edges</span>
        </div>
        <div id="details">
          <p style="color:var(--text-dim); font-size:13px;">Click on any graph node to inspect callers, callees, and jump to code.</p>
        </div>
      </div>
      <div id="graph-container">
        <svg id="graph-svg"></svg>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        const data = ${rawJson};

        document.getElementById('nodeCount').innerText = data.nodes.length + " nodes";
        document.getElementById('edgeCount').innerText = data.links.length + " edges";

        const width = window.innerWidth - 340;
        const height = window.innerHeight;

        const svg = d3.select("#graph-svg");
        const g = svg.append("g");

        const zoom = d3.zoom()
          .scaleExtent([0.1, 8])
          .on("zoom", (e) => g.attr("transform", e.transform));
        svg.call(zoom);

        function resetZoom() {
          svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
        }

        const colorMap = {
          class: "#58a6ff",
          function: "#3fb950",
          module: "#d29922",
          call: "#bc8cff",
          symbol: "#58a6ff",
          unknown: "#8b949e"
        };

        const simulation = d3.forceSimulation(data.nodes)
          .force("link", d3.forceLink(data.links).id(d => d.id).distance(60))
          .force("charge", d3.forceManyBody().strength(-120))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collision", d3.forceCollide().radius(16));

        const link = g.append("g")
          .selectAll("line")
          .data(data.links)
          .enter().append("line")
          .attr("class", "link");

        const node = g.append("g")
          .selectAll("g")
          .data(data.nodes)
          .enter().append("g")
          .attr("class", "node")
          .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended))
          .on("click", (event, d) => selectNode(d));

        node.append("circle")
          .attr("r", d => d.kind === 'class' ? 8 : (d.kind === 'module' ? 7 : 5))
          .attr("fill", d => colorMap[d.kind] || "#8b949e")
          .attr("stroke", "#161b22");

        node.append("text")
          .attr("dx", 9)
          .attr("dy", ".35em")
          .text(d => d.label || d.id);

        simulation.on("tick", () => {
          link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

          node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
        });

        function dragstarted(event, d) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        }

        function dragged(event, d) {
          d.fx = event.x;
          d.fy = event.y;
        }

        function dragended(event, d) {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }

        function selectNode(d) {
          const kindClass = "badge-" + (d.kind || "unknown");
          let html = '<div style="margin-bottom:12px;">' +
            '<span class="badge ' + kindClass + '">' + (d.kind || 'symbol').toUpperCase() + '</span>' +
            '<h3 style="margin-top:6px; font-size:16px;">' + (d.label || d.id) + '</h3>' +
          '</div>';

          if (d.file_path) {
            html += '<p style="font-size:12px; color:var(--text-dim); word-break:break-all;"><strong>File:</strong> ' + d.file_path + (d.start_line ? (':' + d.start_line) : '') + '</p>';
          }

          html += '<div style="margin-top:16px;">';
          if (d.file_path) {
            html += '<button class="btn" onclick="openFile(\\'' + d.file_path.replace(/\\\\/g, '\\\\\\\\') + '\\', ' + (d.start_line || 1) + ')">Open in Editor</button>';
          }
          html += '<button class="btn" onclick="analyzeImpact(\\'' + (d.label || d.id) + '\\')">Blast Radius</button>';
          html += '</div>';

          document.getElementById('details').innerHTML = html;

          // Highlight connected links
          link.classed("highlight", l => l.source.id === d.id || l.target.id === d.id);
        }

        function openFile(filePath, line) {
          vscode.postMessage({ command: 'openFile', filePath: filePath, line: line });
        }

        function analyzeImpact(symbol) {
          vscode.postMessage({ command: 'analyzeImpact', symbol: symbol });
        }

        function filterNodes(term) {
          const lower = term.toLowerCase().trim();
          node.style("opacity", d => {
            if (!lower) return 1;
            const match = (d.label || d.id).toLowerCase().includes(lower) || (d.file_path || '').toLowerCase().includes(lower);
            return match ? 1 : 0.15;
          });
          link.style("opacity", l => {
            if (!lower) return 0.6;
            const srcMatch = (l.source.label || l.source.id).toLowerCase().includes(lower);
            const tgtMatch = (l.target.label || l.target.id).toLowerCase().includes(lower);
            return (srcMatch || tgtMatch) ? 0.9 : 0.05;
          });
        }
      </script>
    </body>
    </html>`;
  }

  public dispose(): void {
    GraphWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
