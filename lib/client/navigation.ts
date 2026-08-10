const SAFE_NEXT_ORIGIN = "https://kintain.invalid";

function isAllowedPathname(pathname: string): boolean {
  return (
    pathname === "/app" ||
    pathname === "/me/history" ||
    pathname === "/me/requests" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

function hasUnsafeCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function safeNextPath(value: string | null): string {
  if (!value || hasUnsafeCharacter(value)) return "/app";

  try {
    const destination = new URL(value, SAFE_NEXT_ORIGIN);
    if (
      destination.origin !== SAFE_NEXT_ORIGIN ||
      !isAllowedPathname(destination.pathname)
    ) {
      return "/app";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/app";
  }
}
