import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { CodeAtlasStatus, GraphData, ImpactAnalysis, SearchResultItem } from "./types";

export class CodeAtlasCli {
  private static instance: CodeAtlasCli;
  private outputChannel: vscode.OutputChannel;
  private resolvedBinaryPath: string | null = null;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel("CodeAtlas");
  }

  public static getInstance(): CodeAtlasCli {
    if (!CodeAtlasCli.instance) {
      CodeAtlasCli.instance = new CodeAtlasCli();
    }
    return CodeAtlasCli.instance;
  }

  public log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  public showOutput(): void {
    this.outputChannel.show(true);
  }

  /**
   * Find the CodeAtlas CLI executable on the system.
   */
  public async getExecutable(): Promise<string> {
    const config = vscode.workspace.getConfiguration("codeatlas");
    const configuredExec = config.get<string>("executable", "codeatlas").trim();

    if (configuredExec && configuredExec !== "codeatlas") {
      return configuredExec;
    }

    if (this.resolvedBinaryPath) {
      return this.resolvedBinaryPath;
    }

    // 1. Check PATH
    const pathBinary = await this.whichBinary("codeatlas");
    if (pathBinary) {
      this.resolvedBinaryPath = pathBinary;
      return pathBinary;
    }

    // 2. Check ~/.cargo/bin/codeatlas
    const cargoBin = path.join(
      os.homedir(),
      ".cargo",
      "bin",
      process.platform === "win32" ? "codeatlas.exe" : "codeatlas"
    );
    if (fs.existsSync(cargoBin)) {
      this.resolvedBinaryPath = cargoBin;
      return cargoBin;
    }

    // 3. Check ~/.local/bin/codeatlas
    const localBin = path.join(
      os.homedir(),
      ".local",
      "bin",
      process.platform === "win32" ? "codeatlas.exe" : "codeatlas"
    );
    if (fs.existsSync(localBin)) {
      this.resolvedBinaryPath = localBin;
      return localBin;
    }

    return "codeatlas";
  }

  private whichBinary(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
      const lookupCmd = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
      child_process.exec(lookupCmd, (err, stdout) => {
        if (!err && stdout.trim()) {
          const firstLine = stdout.trim().split("\n")[0].trim();
          resolve(firstLine);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Run a CLI command and return stdout/stderr.
   */
  public async execute(
    args: string[],
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const executable = await this.getExecutable();
    const workDir = cwd || this.getWorkspaceRoot();

    this.log(`Running: ${executable} ${args.join(" ")} (in ${workDir})`);

    return new Promise((resolve, reject) => {
      const child = child_process.spawn(executable, args, {
        cwd: workDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        this.log(`Execution error: ${err.message}`);
        reject(
          new Error(
            `Failed to run '${executable}'. Please ensure CodeAtlas is installed:\n` +
              `• Rust: cargo install codeatlas\n` +
              `• Python: pip install codeatlas\n\nError: ${err.message}`
          )
        );
      });

      child.on("close", (code) => {
        const exitCode = code ?? 0;
        if (exitCode !== 0 && !stdout) {
          this.log(`Process exited with code ${exitCode}: ${stderr}`);
        }
        resolve({ stdout, stderr, exitCode });
      });
    });
  }

  public getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return process.cwd();
  }

  /**
   * Check if workspace is indexed and CLI is available.
   */
  public async checkAvailability(cwd?: string): Promise<{
    available: boolean;
    version?: string;
    isIndexed: boolean;
  }> {
    try {
      const res = await this.execute(["--version"], cwd);
      const version = res.stdout.trim() || res.stderr.trim();
      const root = cwd || this.getWorkspaceRoot();
      const dbPath = path.join(root, ".codeatlas", "index.db");
      const isIndexed = fs.existsSync(dbPath);
      return { available: true, version, isIndexed };
    } catch {
      return { available: false, isIndexed: false };
    }
  }

  /**
   * Hybrid code search using CodeAtlas CLI.
   */
  public async search(
    query: string,
    limit?: number,
    cwd?: string
  ): Promise<SearchResultItem[]> {
    const config = vscode.workspace.getConfiguration("codeatlas");
    const searchLimit = limit || config.get<number>("searchLimit", 10);
    const embedder = config.get<string>("embedder", "model2vec");

    const args = ["search", query, "-n", searchLimit.toString(), "--json", "--embedder", embedder];

    try {
      const { stdout, stderr, exitCode } = await this.execute(args, cwd);

      if (exitCode !== 0 && !stdout.trim()) {
        if (stderr.includes("not been indexed") || stderr.includes("not indexed")) {
          throw new Error("NOT_INDEXED");
        }
        throw new Error(stderr || `Search failed with code ${exitCode}`);
      }

      const jsonStart = stdout.indexOf("[");
      if (jsonStart === -1) {
        return [];
      }
      const rawJson = stdout.slice(jsonStart);
      return JSON.parse(rawJson) as SearchResultItem[];
    } catch (err: any) {
      if (err.message === "NOT_INDEXED") {
        throw err;
      }
      this.log(`Search error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Change impact analysis (blast radius) for a target symbol.
   */
  public async impact(symbol: string, cwd?: string): Promise<ImpactAnalysis> {
    const args = ["impact", symbol, "--json"];

    try {
      const { stdout, stderr, exitCode } = await this.execute(args, cwd);

      if (exitCode !== 0 && !stdout.trim()) {
        if (stderr.includes("not been indexed") || stderr.includes("not indexed")) {
          throw new Error("NOT_INDEXED");
        }
        throw new Error(stderr || `Impact analysis failed with code ${exitCode}`);
      }

      const jsonStart = stdout.indexOf("{");
      if (jsonStart === -1) {
        return {
          target: symbol,
          direct_dependents: [],
          affected_count: 0,
        };
      }
      const rawJson = stdout.slice(jsonStart);
      return JSON.parse(rawJson) as ImpactAnalysis;
    } catch (err: any) {
      if (err.message === "NOT_INDEXED") {
        throw err;
      }
      this.log(`Impact error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Trigger codebase re-indexing.
   */
  public async index(
    cwd?: string,
    force: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    const config = vscode.workspace.getConfiguration("codeatlas");
    const embedder = config.get<string>("embedder", "model2vec");

    const args = ["index"];
    if (force) {
      args.push("--full");
    }
    args.push("--embedder", embedder);

    try {
      const { stdout, stderr, exitCode } = await this.execute(args, cwd);
      const output = stdout + stderr;
      if (exitCode === 0 || output.includes("complete") || output.includes("Indexed")) {
        return { success: true, message: output };
      }
      return { success: false, message: output };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Get repository index status and metrics.
   */
  public async getStatus(cwd?: string): Promise<CodeAtlasStatus> {
    const root = cwd || this.getWorkspaceRoot();
    const dbPath = path.join(root, ".codeatlas", "index.db");

    const status: CodeAtlasStatus = {
      repo_path: root,
      db_path: dbPath,
      is_indexed: fs.existsSync(dbPath),
    };

    if (fs.existsSync(dbPath)) {
      try {
        const stats = fs.statSync(dbPath);
        status.db_size = `${(stats.size / 1024).toFixed(1)} KB`;
      } catch {
        // ignore
      }
    }

    try {
      const res = await this.execute(["graph", "stats"], cwd);
      const text = res.stdout + res.stderr;

      // Extract numbers with regex matching from status / stats output
      const fileMatch = text.match(/files?[:\s]+(\d+)/i);
      const symbolMatch = text.match(/symbols?[:\s]+(\d+)/i);
      const edgeMatch = text.match(/edges?[:\s]+(\d+)/i);
      const chunkMatch = text.match(/chunks?[:\s]+(\d+)/i);

      if (fileMatch) {
        status.files = parseInt(fileMatch[1], 10);
      }
      if (symbolMatch) {
        status.symbols = parseInt(symbolMatch[1], 10);
      }
      if (edgeMatch) {
        status.edges = parseInt(edgeMatch[1], 10);
      }
      if (chunkMatch) {
        status.chunks = parseInt(chunkMatch[1], 10);
      }
    } catch {
      // ignore
    }

    return status;
  }

  /**
   * Export knowledge graph to JSON.
   */
  public async exportGraph(cwd?: string): Promise<GraphData | null> {
    const tmpFile = path.join(
      os.tmpdir(),
      `codeatlas_graph_${Date.now()}.json`
    );

    try {
      await this.execute(["export", "-f", "json", "-o", tmpFile], cwd);
      if (fs.existsSync(tmpFile)) {
        const content = fs.readFileSync(tmpFile, "utf-8");
        fs.unlinkSync(tmpFile);
        return JSON.parse(content) as GraphData;
      }
    } catch (err: any) {
      this.log(`Export graph error: ${err.message}`);
    }
    return null;
  }

  /**
   * Install git hooks.
   */
  public async installHooks(cwd?: string): Promise<string> {
    const res = await this.execute(["hook", "install"], cwd);
    return res.stdout + res.stderr;
  }

  /**
   * Uninstall git hooks.
   */
  public async uninstallHooks(cwd?: string): Promise<string> {
    const res = await this.execute(["hook", "uninstall"], cwd);
    return res.stdout + res.stderr;
  }
}
