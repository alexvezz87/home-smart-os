name: "✨ Feature Request"
description: "Nuovo modulo, nuova integrazione dispositivo o funzionalità da zero"
title: "[FEATURE] "
labels: ["type: feature"]
body:
  - type: textarea
    id: goal
    attributes:
      label: "Obiettivo della Feature"
      description: "Descrivi chiaramente la nuova funzionalità da sviluppare."
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: "Criteri di Accettazione"
      description: "Elenca i requisiti tecnici e funzionali per considerare completata l'Issue."
    validations:
      required: true
  - type: textarea
    id: wiki
    attributes:
      label: "Pagine Wiki da Aggiornare"
      value: |
        - [ ] `wiki/Funzionalita-e-Moduli.md`
        - [ ] `wiki/Ecosistemi-e-API-Esterne.md` (se pertinente)
        - [ ] `wiki/Architettura-e-Database.md` (se modifica TiDB `db_home_os`)
        - [ ] `wiki/Storico-Modifiche.md`
