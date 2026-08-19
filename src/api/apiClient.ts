export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(private readonly baseUrl = "/api/v1") {}

  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json" });

    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: "same-origin",
      headers,
      signal
    });

    if (!response.ok) {
      throw new ApiError("The server could not complete the request.", response.status);
    }

    return response.json();
  }
}
