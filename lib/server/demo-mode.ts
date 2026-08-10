export type DemoModeEnvironment = Pick<
  Env,
  "ALLOW_PUBLIC_DEMO" | "DEMO_MODE" | "SHOW_DEMO_CREDENTIALS"
>;

export function isPublicDemoMode(environment: DemoModeEnvironment): boolean {
  return (
    environment.DEMO_MODE === "true" &&
    environment.ALLOW_PUBLIC_DEMO === "true" &&
    environment.SHOW_DEMO_CREDENTIALS === "true"
  );
}
