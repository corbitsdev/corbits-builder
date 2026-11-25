// The slice of oxlint's JS plugin API the rules here use; oxlint does not export these types.
export type Name = { name?: string; value?: unknown };
export type Operand = Name & {
  type?: string;
  property?: Name;
  expression?: Operand;
};
export type Node = {
  key?: Name;
  left?: Operand;
  right?: Operand;
  operator?: string;
  discriminant?: Operand;
  cases?: { test: Operand | null }[];
  elements?: (Operand | null)[];
};
export type Context = {
  report: (report: { node: Node; message: string }) => void;
};
export type Rule = {
  create: (context: Context) => Record<string, (node: Node) => void>;
};
