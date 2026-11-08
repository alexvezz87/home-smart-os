name: "⚡ Enhancement"
description: "Miglioramento UX/UI, estensione vocale o ottimizzazione di un modulo esistente"
title: "[ENHANCE] "
labels: ["type: enhancement"]
body:
  - type: textarea
    id: improvement
    attributes:
      label: "Descrizione del Miglioramento"
      description: "Quale funzionalità esistente viene migliorata e come?"
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: "Criteri di Accettazione"
    validations:
      required: true
