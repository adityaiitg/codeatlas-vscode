import * as vscode from "vscode";
import { CodeAtlasCli } from "../cliRunner";

interface CachedImpact {
  callers: number;
  affected: number;
  timestamp: number;
}

export class CallerCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private cache: Map<string, CachedImpact> = new Map();
  private pending: Set<string> = new Set();
  private cacheTtlMs = 60 * 1000; // 1 minute TTL

  constructor(private cli: CodeAtlasCli) {}

  public refresh(): void {
    this.cache.clear();
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration("codeatlas");
    if (!config.get<boolean>("codelensEnabled", true)) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    // Fast regex pattern for function and class definitions across Python, JS/TS, Rust, Go
    const defRegex =
      /^(?:export\s+)?(?:async\s+)?(?:def\s+|class\s+|function\s+|pub\s+fn\s+|fn\s+|pub\s+struct\s+|struct\s+|type\s+|func\s+)([A-Za-z0-9_]+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = defRegex.exec(line);
      if (match && match[1]) {
        const symbolName = match[1];
        if (symbolName.length >= 2 && !["if", "for", "while", "return", "switch", "match"].includes(symbolName)) {
          const range = new vscode.Range(i, 0, i, 0);
          const lens = new vscode.CodeLens(range);
          (lens as any).symbolName = symbolName;
          codeLenses.push(lens);
        }
      }
    }

    return codeLenses;
  }

  public async resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens> {
    const symbolName = (codeLens as any).symbolName;
    if (!symbolName) {
      return codeLens;
    }

    const now = Date.now();
    const cached = this.cache.get(symbolName);
    if (cached && now - cached.timestamp < this.cacheTtlMs) {
      codeLens.command = {
        title: this.formatTitle(cached.callers, cached.affected),
        command: "codeatlas.impact",
        arguments: [symbolName],
      };
      return codeLens;
    }

    if (this.pending.has(symbolName)) {
      codeLens.command = {
        title: "$(sync~spin) CodeAtlas...",
        command: "codeatlas.impact",
        arguments: [symbolName],
      };
      return codeLens;
    }

    this.pending.add(symbolName);

    try {
      const impact = await this.cli.impact(symbolName);
      const callers = impact.direct_dependents.length;
      const affected = impact.affected_count;

      this.cache.set(symbolName, {
        callers,
        affected,
        timestamp: now,
      });

      codeLens.command = {
        title: this.formatTitle(callers, affected),
        command: "codeatlas.impact",
        arguments: [symbolName],
      };
    } catch {
      codeLens.command = {
        title: "$(pulse) CodeAtlas Impact",
        command: "codeatlas.impact",
        arguments: [symbolName],
      };
    } finally {
      this.pending.delete(symbolName);
    }

    return codeLens;
  }

  private formatTitle(callers: number, affected: number): string {
    if (callers === 0 && affected === 0) {
      return "$(references) 0 callers (leaf)";
    }
    const callerText = callers === 1 ? "1 caller" : `${callers} callers`;
    if (affected > callers) {
      return `$(pulse) ${callerText} • ${affected} blast radius`;
    }
    return `$(references) ${callerText}`;
  }
}
