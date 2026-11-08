name: "♻️ Refactor"
description: "Riorganizzazione architetturale, migrazione database TiDB o pulizia codice"
title: "[REFACTOR] "
labels: ["type: refactor"]
body:
  - type: textarea
    id: refactor
    attributes:
      label: "Obiettivo del Refactoring"
      description: "Quali componenti vengono riorganizzati senza alterare il comportamento esterno?"
    validations:
      required: true
