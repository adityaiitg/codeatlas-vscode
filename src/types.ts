/**
 * CodeAtlas VS Code Extension Data Models & Types
 */

export interface SearchResultItem {
  chunk_id: string;
  symbol_id?: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  chunk_type: string;
  is_definition: boolean;
  score: number;
  neighbors?: Array<{
    kind: string;
    name: string;
    file_path: string;
    start_line: number;
  }>;
}

export interface ImpactAnalysis {
  target: string;
  direct_dependents: string[];
  affected_count: number;
  blast_radius?: string[];
  matches?: string[];
}

export interface CodeAtlasStatus {
  files?: number;
  symbols?: number;
  edges?: number;
  chunks?: number;
  vectors?: number;
  db_size?: string;
  db_path?: string;
  repo_path?: string;
  embedding_model?: string;
  is_indexed?: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: "class" | "function" | "module" | "call" | "symbol" | "unknown";
  file_path?: string;
  start_line?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
