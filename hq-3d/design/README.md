# Design models

Balance work that has not been built yet. Numbers here are computed, not typed:
the document is generated from the model, so a constant only changes in one place.

    python3 forage_model.py      # importable; nothing runs on its own
    python3 build_doc.py         # regenerate the tables
    forage_ledger.html           # the published document

`forage_model.py` is anchored to the economy already shipping in
`roomsrc/trades.js` -- Common 3, Uncommon 6, Rare 14, Ultra 70 CashCoin and the
shovel yields. If the two ever disagree, trades.js is right and the model is
stale: trades.js is the live economy, this is a proposal for growing it.
