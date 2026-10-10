export type Tag = "safe" | "loses-feature" | "not-recommended";

export interface CuratedApp {
  pkg: string;
  name: string;
  tag: Tag;
  explanation: string;
  verified: boolean;
}
