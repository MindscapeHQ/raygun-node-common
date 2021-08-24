declare module 'v8-profiler-node8' {
  export type Timestamp = number;
  export type GraphID = number;

  export type GraphNode = {
    functionName: string;
    url: string;
    lineNumber: number;
    callUID: number;
    bailoutReason: string;
    id: number;
    scriptId: number;
    hitCount: number;
    children: GraphNode[];
  };

  export type V8Profile = {
    title: string;
    timestamps: Timestamp[];
    samples: GraphID[];
    head: GraphNode;
  };

  export function startProfiling(name: string): void;
  export function stopProfiling(name: string): V8Profile;
  export function setSamplingInterval(frequency: number): void;
  export function collectSample(): void;
}
