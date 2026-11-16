/** A mill service saying no, in the person's words: answered as 400 by `millRoute`. */
export class MillRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MillRefusal";
  }
}

export function millRefusal(message: string): MillRefusal {
  return new MillRefusal(message);
}
