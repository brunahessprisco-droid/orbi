/** Erro HTTP explícito para o handler global em server.ts */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export function getHttpErrorStatus(err: unknown): number | null {
  if (err instanceof HttpError) return err.status;
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number" && s >= 400 && s < 600) return s;
  }
  return null;
}
