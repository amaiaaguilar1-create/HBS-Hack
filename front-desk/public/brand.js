// Firsthand branding (Main Street). Every screen reads from this file; theme.css restyles the rest.
// Same palette as the brand kit, with two small-text values darkened to pass WCAG AA on paper.
window.BRAND = {
  name: 'Firsthand',
  tagline: 'Keep the call human.',
  colors: {
    bg: '#F6F1E7',        // warm paper: live calls + stage background
    surface: '#FCFAF5',   // cards and lanes
    line: '#E5DDCD',
    fg: '#1E2A24',        // ink (deep green-black)
    muted: '#5B6660',
    human: '#C8432B',     // tomato: people (white text on it is 4.89:1)
    humanSoft: '#F8DCD3',
    agent: '#2D4BD8',     // cobalt: AI agents
    agentSoft: '#DDE3FA',
    spam: '#6B665B',      // stone: bots (kit #7A7468 is 4.12:1 on paper)
    ok: '#2F7A49',        // moss: confirmed, paid
    paper: '#F6F1E7',     // dashboard background
    ink: '#1E2A24',
    inkMuted: '#5B6660',
    humanInk: '#B23A24',  // tomato for small text (5.29:1 on paper)
    agentInk: '#2D4BD8',
  },
};
