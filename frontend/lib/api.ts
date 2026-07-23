const API = "/api";

export async function api<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      let message = `Error ${response.status}: ${response.statusText}`;

      try {
        const data = await response.json();
        message = data.detail || data.message || message;
      } catch {
        // La respuesta no era JSON.
      }

      throw new Error(message);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`No se pudo conectar con la API: ${error.message}`);
    }

    throw new Error("No se pudo conectar con la API.");
  }
}