name: "💡 Idea / Proposal"
description: "Proponi una nuova idea architetturale, studio di fattibilità o integrazione IoT"
title: "[IDEA] "
labels: ["type: idea"]
body:
  - type: textarea
    id: summary
    attributes:
      label: "Descrizione dell'Idea"
      description: "Spiega l'idea, il problema che risolve e il valore per l'ecosistema Home Smart OS."
    validations:
      required: true
  - type: textarea
    id: architecture
    attributes:
      label: "Impatto Architetturale / Ecosistemi Coinvolti"
      description: "Quali moduli o dispositivi tocca? (Google Home, Bosch, ABB, Volvo, Meross, Hue, Tapo, TiDB, Cloud)"
