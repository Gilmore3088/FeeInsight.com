import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfigSidebar } from "./reports/ConfigSidebar";

describe("ConfigSidebar", () => {
  it("preserves selected institution context on the defaults link", () => {
    const html = renderToStaticMarkup(
      <ConfigSidebar
        selectedTemplate={null}
        selectedInstitutionId="2945"
        institutionName="Example Bank"
        peerSetLabel="national peers"
        peerSetId={null}
        defaultPeerSetLabel="Same state peers"
        savedPeerSets={[]}
        narrativeTone="executive"
        isGenerating={false}
        peerCoveragePreview={null}
        isPeerCoverageLoading={false}
        peerCoverageError={null}
        onPeerSetChange={vi.fn()}
        onNarrativeToneChange={vi.fn()}
        clientGoal="win_accounts"
        onClientGoalChange={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    expect(html).toContain('href="/pro/settings?instId=2945"');
    expect(html).toContain('aria-label="Goal"');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Win accounts/);
  });
});
