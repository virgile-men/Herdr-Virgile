// Sandboxes sbx : retirées de cette copie (sbx est un outil de l'auteur, sur une de ses machines).
// Même interface que l'original pour main.js et sous-agents.js : aucune session, donc rien n'est lu.
export const HOTE = null;

export class SandboxesSbx {
  constructor() { this.session = null; this.dernierTour = 0; this.erreur = null; this.lu = true; }
  viser(_id) {}
  async lire() {}
  nombre() { return 0; }
  elements() { return { enCours: [], fin: [] }; }
}
