const allowedVars = ["product_name", "product_url", "brand_name", "country"] as const;
type AllowedVar = (typeof allowedVars)[number];

export function allowedVariables(): string[] {
  return [...allowedVars];
}

export function resolveVariables(template: string, vars: Record<AllowedVar, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    if (!allowedVars.includes(key as AllowedVar)) {
      throw new Error(`Unknown variable: ${key}`);
    }
    return vars[key as AllowedVar] ?? "";
  });
}

export function findUnknownVariables(template: string): string[] {
  const matches = template.match(/{{\s*([a-zA-Z0-9_]+)\s*}}/g) || [];
  const unknown: string[] = [];
  for (const m of matches) {
    const key = m.replace(/[{}]/g, "").trim();
    if (!allowedVars.includes(key as AllowedVar)) unknown.push(key);
  }
  return unknown;
}

