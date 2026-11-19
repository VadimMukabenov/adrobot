import type { Creation, Operation } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg: string }) => item.msg).join("; ")
          : `Request failed (HTTP ${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  return readResponse<T>(response);
}

export async function createCampaign(
  body: Creation,
  onProgress: (operation: Operation) => void,
): Promise<Operation> {
  const response = await fetch("/api/campaigns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(body),
  });
  // Keep compatibility with a server still running the previous JSON API.
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/x-ndjson")
  )
    return readResponse(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Creation progress connection is unavailable.");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Operation | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new ApiError(event.status, event.detail);
    const operation = event.operation as Operation;
    if (!operation || operation.operation_id !== body.operation_id)
      throw new Error("Creation progress does not match the saved operation.");
    if (event.type === "progress") onProgress(operation);
    if (event.type === "result") result = operation;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) consume(line);
      if (buffer.length > 65536)
        throw new Error("Invalid creation progress response.");
      if (done) break;
    }
    consume(buffer);
    if (!result)
      throw new Error(
        "Creation response was interrupted. The saved operation is retained.",
      );
    return result;
  } finally {
    reader.releaseLock();
  }
}

export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed.";
