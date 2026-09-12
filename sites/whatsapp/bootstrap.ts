// esbuild turns this conditional import into a local initializer in one IIFE.
// No CDN, Node process, second login session, or remote executable is involved.
const page = window as unknown as { WPP?: unknown; __nodelaneWaLoading?: boolean; __nodelaneWaFailed?: boolean };
if (location.origin === "https://web.whatsapp.com" && !page.WPP && !page.__nodelaneWaLoading && !page.__nodelaneWaFailed) {
  page.__nodelaneWaLoading = true;
  void import("@wppconnect/wa-js").then(() => {
    page.__nodelaneWaLoading = false;
  }).catch(() => {
    page.__nodelaneWaLoading = false;
    page.__nodelaneWaFailed = true;
  });
}
