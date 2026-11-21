/**
 * The server-only side of an extension's sidebar: figures and per-person
 * choices that need the database. Registered in `extensions/server.ts`,
 * never on the proxy's path.
 */
export type ExtensionNavContext = {
  userId: string;
  companyId: string;
  role: string | null;
};

/** One person's place in the extension: where they start and what their phone bar holds. */
export type ExtensionPersona = {
  /** Their start page: an address the extension's sidebar shows. Ignored if they may not open it. */
  home?: string;
  /** Up to four sidebar rows, by id (core's or the extension's), for the phone's bottom bar, in order. */
  phone?: string[];
};

export interface ExtensionNavServer {
  /** The extension's id, as in `extensions/index.ts`. */
  id: string;
  /**
   * The counts beside rows, by address ("4" beside Intake): things waiting
   * for this person. Only addresses inside the extension are kept.
   */
  badges?: (context: ExtensionNavContext) => Promise<Record<string, string>>;
  /** Where this person starts and what their phone bar holds, from the extension's own roles. */
  persona?: (context: ExtensionNavContext) => Promise<ExtensionPersona | null>;
}
