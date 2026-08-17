# Handover — 2026-08-17 (Cursor — plano v1.3 Treinador)

## What changed this session
- [`treinador-plan.md`](treinador-plan.md): inventário de refactor §7.1–7.3 (não estava completo). Sem código.

## Key decisions (and why)
- Primeira versão do plano cobria o *modelo*; faltava o *diff*. Agora lista Session+LocalSession, `castAbility`, skills de mana, morte súbita, Mongo, testes, SpellRange, GDD §6/§12.

## Plan / todo status
- Plan: `treinador-plan.md` — produto + checklist de arquivos
- Pending: Q6/Q7/Q8; destino de `mana_flow`/`dark_tribute`; dial da morte súbita; tabela §3.2

## Next steps
1. Fechar Q6/Q7/Q8 **e** os dois buracos de mana (skills + sudden death).
2. Fase 0 (JSON + teste de catálogo).
3. Fase 1+2 no mesmo corte de `sim/**` — `LocalSession` não pode atrasar.
