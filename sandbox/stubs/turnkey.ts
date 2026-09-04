/**
 * Stand-in for `@turnkey/iframe-stamper`, the cross origin iframe that holds
 * the user's private key material. It is key custody, so it is backend owned
 * and excluded from the export. Aliased in next.config.mjs; nothing under
 * `source/` imports this directly.
 *
 * It reports a successful init and then refuses the export itself, which is
 * the honest answer: there is no key here to reveal. The recovery panel
 * therefore renders its full chrome and its failure state, and never its
 * "here is your seed phrase" state. That is the intended limit of a sandbox.
 */

export interface IframeStamperConfig {
  iframeUrl?: string;
  iframeContainer?: HTMLElement | null | undefined;
  iframeElementId?: string;
}

export class IframeStamper {
  private readonly container: HTMLElement | null;
  private readonly elementId: string;
  private iframe: HTMLIFrameElement | null = null;

  constructor(config: IframeStamperConfig = {}) {
    this.container = config.iframeContainer ?? null;
    this.elementId = config.iframeElementId ?? 'turnkey-sandbox-iframe';
  }

  /** Mounts an empty same origin iframe and returns a placeholder public key. */
  async init(): Promise<string> {
    if (this.container && !this.iframe) {
      const el = document.createElement('iframe');
      el.id = this.elementId;
      el.setAttribute('title', 'sandbox key iframe');
      el.style.border = '0';
      el.style.width = '100%';
      this.container.appendChild(el);
      this.iframe = el;
    }
    return 'sandbox-embedded-public-key';
  }

  applySettings(_settings: unknown): boolean {
    return true;
  }

  async injectWalletExportBundle(_bundle: string, _organizationId?: string): Promise<boolean> {
    // No real bundle can be decrypted here, so the panel shows its error path.
    return false;
  }

  async injectKeyExportBundle(_bundle: string, _organizationId?: string): Promise<boolean> {
    return false;
  }

  clear(): void {
    this.iframe?.remove();
    this.iframe = null;
  }
}

export default IframeStamper;
