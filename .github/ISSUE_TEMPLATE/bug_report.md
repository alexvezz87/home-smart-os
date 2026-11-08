name: "🐛 Bug Report"
description: "Segnala un errore, anomalia API, disconnessione OAuth o regressione"
title: "[BUG] "
labels: ["type: bug"]
body:
  - type: textarea
    id: bug
    attributes:
      label: "Descrizione del Problema"
      description: "Cosa succede e qual è il comportamento atteso?"
    validations:
      required: true
  - type: textarea
    id: root_cause
    attributes:
      label: "Root Cause & Passi per Riprodurre"
