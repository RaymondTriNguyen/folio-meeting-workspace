import type { Item, Meeting, Segment } from "./domain";

const specs = [
  {
    id: "product-kickoff",
    title: "Website redesign kickoff",
    project: "Website redesign",
    date: "2026-09-25T09:00:00",
    duration: 2580,
    people: ["Olivia Chen", "Marcus Reed", "Sofia Patel"],
    summary:
      "The team aligned on a calmer, more intuitive website experience, with the customer journey at the center. The first release will focus on a streamlined navigation system, accessible components, and a faster checkout. A two-week discovery sprint will establish the design direction before development begins.",
    requirement:
      "The navigation must make pricing and product features accessible in one click.",
    decision:
      "We agreed to use a component-based design system for the redesign.",
    action: "I will share the first wireframes by October 2.",
    risk: "The existing checkout integration may delay the development handoff.",
    question: "Do we need to support additional currencies at launch?",
  },
  {
    id: "roadmap-planning",
    title: "Q4 product roadmap",
    project: "Product strategy",
    date: "2026-09-24T14:30:00",
    duration: 3300,
    people: ["Marcus Reed", "James Wilson", "Olivia Chen"],
    summary:
      "The Q4 roadmap prioritizes enterprise onboarding and a more flexible reporting experience. The team agreed to sequence single sign-on before custom dashboards and preserve a dedicated capacity buffer for customer feedback. Delivery dates will be confirmed after the technical discovery.",
    requirement:
      "Enterprise accounts must support single sign-on with their identity provider.",
    decision:
      "We agreed that single sign-on will ship before custom dashboards.",
    action:
      "I will document the enterprise onboarding requirements by September 30.",
    risk: "The identity provider review could extend the onboarding timeline.",
    question: "Which identity providers do our pilot customers use?",
  },
  {
    id: "client-discovery",
    title: "Acme Co. discovery call",
    project: "Client work",
    date: "2026-09-24T10:00:00",
    duration: 2160,
    people: ["Sofia Patel", "Alex Morgan", "James Wilson"],
    summary:
      "Acme needs a single place to track client requests and see which commitments remain open. The pilot will center on the account management team, with a simple approval flow and a weekly export for stakeholders. The client will supply anonymized examples before implementation.",
    requirement:
      "Every client request must have an owner and a visible approval status.",
    decision: "We agreed to run the pilot with the account management team.",
    action: "I will send anonymized request examples by September 29.",
    risk: "Historical request data may not have consistent ownership information.",
    question:
      "Who should approve requests when the account owner is unavailable?",
  },
  {
    id: "design-review",
    title: "Design system review",
    project: "Website redesign",
    date: "2026-09-23T11:00:00",
    duration: 1920,
    people: ["Olivia Chen", "Sofia Patel"],
    summary:
      "The component review established a shared direction for typography, accessible interaction states, and form patterns. The team chose to consolidate duplicate components and test navigation with keyboard users before the next release.",
    requirement:
      "All interactive components must support keyboard navigation and visible focus states.",
    decision:
      "We agreed to consolidate the two button libraries into one component set.",
    action:
      "I will audit form components for keyboard accessibility by September 28.",
    risk: "Legacy pages still depend on deprecated component styles.",
    question: "Can we migrate the legacy pages in the same release?",
  },
  {
    id: "engineering-sync",
    title: "Engineering weekly sync",
    project: "Product strategy",
    date: "2026-09-22T15:00:00",
    duration: 1800,
    people: ["Marcus Reed", "James Wilson", "Alex Morgan"],
    summary:
      "Engineering reviewed the release pipeline and agreed to prioritize reliability before adding new integrations. The next sprint includes deployment checks, clearer operational alerts, and a review of the slowest database queries.",
    requirement:
      "Every production release must pass automated integration checks.",
    decision:
      "We agreed to prioritize deployment reliability in the next sprint.",
    action: "I will review the slowest database queries by September 27.",
    risk: "The staging environment does not yet match production configuration.",
    question: "Which alerts need to reach the on-call engineer immediately?",
  },
  {
    id: "customer-feedback",
    title: "Customer feedback roundup",
    project: "Client work",
    date: "2026-09-21T09:30:00",
    duration: 2700,
    people: ["Sofia Patel", "Alex Morgan"],
    summary:
      "Customer interviews showed that finding past decisions and tracking follow-ups are the biggest sources of friction. The team will test a simplified search experience and a consolidated action list before broadening the feature set.",
    requirement:
      "Users must be able to search past meeting decisions by keyword.",
    decision:
      "We agreed to test the search experience with five existing customers.",
    action: "I will schedule five customer feedback sessions by September 30.",
    risk: "Interview participants may overrepresent our most active customers.",
    question:
      "How should we include less active customers in the next research round?",
  },
];

export function demoMeetings(): Meeting[] {
  return specs.map((s, index) => {
    const lines = [
      {
        text: `Let's align on ${s.project.toLowerCase()} and the outcomes for this week.`,
        speaker: s.people[0],
        start: 0,
      },
      { text: s.requirement, speaker: s.people[1], start: 164 },
      { text: s.decision, speaker: s.people[0], start: 482 },
      { text: s.action, speaker: s.people[1], start: 721 },
      { text: s.risk, speaker: s.people[2] || s.people[0], start: 994 },
      { text: s.question, speaker: s.people[0], start: 1250 },
      {
        text: "I will share the meeting notes with the team and confirm the open questions at our next check-in.",
        speaker: s.people[0],
        start: s.duration - 80,
      },
    ];
    const transcript: Segment[] = lines.map((l, i) => ({
      id: `seg-${i + 1}`,
      ...l,
      end: l.start + 18,
    }));
    const kinds: Item["kind"][] = [
      "requirement",
      "decision",
      "action",
      "risk",
      "question",
      "action",
    ];
    const items: Item[] = kinds.map((kind, i) => ({
      id: `${kind}-${i + 1}`,
      kind,
      text: transcript[i + 1].text,
      category:
        kind === "requirement"
          ? index === 3
            ? "Non-functional"
            : "Functional"
          : kind === "risk"
            ? "Delivery"
            : "General",
      priority:
        kind === "requirement" || (kind === "action" && index < 2)
          ? "must"
          : "should",
      owner: kind === "action" ? transcript[i + 1].speaker : null,
      dueDate:
        kind === "action"
          ? i === 2
            ? [
                "2026-10-02",
                "2026-09-30",
                "2026-09-29",
                "2026-09-28",
                "2026-09-27",
                "2026-09-30",
              ][index]
            : "2026-09-28"
          : null,
      segmentId: transcript[i + 1].id,
      evidence: transcript[i + 1].text,
      confidence: kind === "risk" && index < 2 ? 0.74 : 0.95,
      inferred: false,
      review: kind === "risk" && index < 2 ? "needs-review" : "verified",
      completed: kind === "action" && index > 3,
    }));
    return {
      id: s.id,
      title: s.title,
      project: s.project,
      participants: s.people,
      context: "Curated sample meeting for exploring Folio.",
      createdAt: s.date,
      duration: s.duration,
      sourceName: null,
      sourcePath: null,
      length: "standard",
      status: "ready",
      stage: "Ready to review",
      error: null,
      transcript,
      summary: s.summary,
      topics: [
        {
          title: "Goals & requirements",
          summary: s.requirement,
          segmentId: "seg-2",
        },
        { title: "The way forward", summary: s.decision, segmentId: "seg-3" },
        {
          title: "Risks & follow-up",
          summary: `${s.risk} ${s.question}`,
          segmentId: "seg-5",
        },
      ],
      items,
    };
  });
}
