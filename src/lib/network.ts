export async function hasInternet(timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch("https://www.gstatic.com/generate_204", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
