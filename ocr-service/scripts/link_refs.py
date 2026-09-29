"""
Script de rattrapage — rattache les repères de vue éclatée (`references_vues`)
aux lignes de nomenclature (`nomenclature`) sans relancer l'OCR ni Ollama
(ce service ne dépend d'ailleurs pas d'Ollama : la jointure est un pur rapprochement
de texte en base).

Complète le endpoint existant `POST /ocr/jointure` (jointure stricte par égalité
exacte de `part_number`/`ref_no`) avec une tolérance de normalisation :
  - passage en majuscules
  - suppression des espaces et tirets parasites
  - confusion OCR O/0 et I/1 (translate équivalent des deux côtés de la comparaison)

Usage :
    python scripts/link_refs.py                  # tous les catalogues
    python scripts/link_refs.py --catalogue-id 2  # un seul catalogue
    python scripts/link_refs.py --dry-run         # affiche le rapport sans écrire

Le rapport donne, par catalogue : le nombre de repères déjà liés (jointure stricte
existante), le nombre nouvellement liés par ce script, et le taux de rattachement final.
"""
import argparse
import asyncio
import os

import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")

# Normalisation appliquée aux deux côtés de la comparaison avant de juger deux
# chaînes "équivalentes" : majuscules, espaces/tirets retirés, O/0 et I/1 confondus.
# `translate` de Postgres est utilisé côté SQL pour rester proche du moteur réel
# (une normalisation Python isolée pourrait diverger d'une future requête SQL).
NORMALIZE_SQL = "translate(upper(replace(replace({col}, ' ', ''), '-', '')), 'OI', '01')"


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


async def link_catalogue(db: asyncpg.Connection, catalogue_id: int, dry_run: bool) -> dict:
    norm_n  = NORMALIZE_SQL.format(col="n.part_number")
    norm_rn = NORMALIZE_SQL.format(col="n.ref_no")
    norm_rv = NORMALIZE_SQL.format(col="rv.part_number")

    total = await db.fetchval(
        """SELECT COUNT(*) FROM references_vues rv
           JOIN page p ON p.id = rv.page_id
           WHERE p.id_catalogue = $1""",
        catalogue_id,
    )
    deja_lies = await db.fetchval(
        """SELECT COUNT(DISTINCT rv.id) FROM references_vues rv
           JOIN page p ON p.id = rv.page_id
           JOIN ref_vue_nomenclature rvn ON rvn.ref_vue_id = rv.id
           WHERE p.id_catalogue = $1""",
        catalogue_id,
    )

    if dry_run:
        # Compte ce qui serait nouvellement lié sans écrire (mêmes prédicats que l'INSERT ci-dessous)
        nouveaux = await db.fetchval(
            f"""SELECT COUNT(DISTINCT rv.id) FROM references_vues rv
                JOIN page p ON p.id = rv.page_id AND p.id_catalogue = $1
                LEFT JOIN ref_vue_nomenclature rvn ON rvn.ref_vue_id = rv.id
                JOIN nomenclature n ON n.catalogue_id = $1
                    AND (
                        ({norm_rv} = {norm_rn} AND n.source_page_id = rv.page_id AND n.ref_no IS NOT NULL AND n.ref_no != '')
                        OR {norm_rv} = {norm_n}
                    )
                WHERE rvn.ref_vue_id IS NULL""",
            catalogue_id,
        )
    else:
        # Jointure normalisée par ref_no (même page), priorité la plus fiable
        r1 = await db.fetchrow(
            f"""WITH matched AS (
                   INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id, join_type)
                   SELECT DISTINCT ON (rv.id) rv.id, n.id, 'ref_no_norm'
                   FROM references_vues rv
                   JOIN page p ON p.id = rv.page_id AND p.id_catalogue = $1
                   JOIN nomenclature n ON n.source_page_id = rv.page_id
                       AND n.ref_no IS NOT NULL AND n.ref_no != ''
                       AND {norm_rv} = {norm_rn}
                   ORDER BY rv.id, n.id
                   ON CONFLICT (ref_vue_id, nomenclature_id) DO NOTHING
                   RETURNING ref_vue_id
               )
               SELECT COUNT(*) AS c FROM matched""",
            catalogue_id,
        )
        # Jointure normalisée par part_number (tout le catalogue)
        r2 = await db.fetchrow(
            f"""WITH matched AS (
                   INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id, join_type)
                   SELECT DISTINCT ON (rv.id) rv.id, n.id, 'part_number_norm'
                   FROM references_vues rv
                   JOIN page p ON p.id = rv.page_id AND p.id_catalogue = $1
                   LEFT JOIN ref_vue_nomenclature existing ON existing.ref_vue_id = rv.id
                   JOIN nomenclature n ON n.catalogue_id = $1
                       AND {norm_rv} = {norm_n}
                   WHERE existing.ref_vue_id IS NULL
                   ORDER BY rv.id, n.id
                   ON CONFLICT (ref_vue_id, nomenclature_id) DO NOTHING
                   RETURNING ref_vue_id
               )
               SELECT COUNT(*) AS c FROM matched""",
            catalogue_id,
        )
        nouveaux = (r1["c"] if r1 else 0) + (r2["c"] if r2 else 0)

    lies_final = deja_lies + (0 if dry_run else nouveaux)
    taux = round(100 * lies_final / total, 1) if total else 0.0

    return {
        "catalogue_id": catalogue_id,
        "total_reperes": total,
        "deja_lies": deja_lies,
        "nouveaux_lies": nouveaux,
        "lies_final": lies_final,
        "taux_pct": taux,
    }


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue-id", type=int, default=None, help="Limiter à un catalogue")
    parser.add_argument("--dry-run", action="store_true", help="N'écrit rien, affiche seulement le rapport")
    args = parser.parse_args()

    db = await _get_db()
    try:
        if args.catalogue_id:
            cat_ids = [args.catalogue_id]
        else:
            rows = await db.fetch("SELECT id FROM catalogue ORDER BY id")
            cat_ids = [r["id"] for r in rows]

        results = []
        for cid in cat_ids:
            async with db.transaction():
                res = await link_catalogue(db, cid, args.dry_run)
            results.append(res)

        print(f"{'catalogue':>10} {'total':>8} {'déjà liés':>10} {'nouveaux':>9} {'total lié':>10} {'taux':>7}")
        for r in results:
            print(f"{r['catalogue_id']:>10} {r['total_reperes']:>8} {r['deja_lies']:>10} "
                  f"{r['nouveaux_lies']:>9} {r['lies_final']:>10} {r['taux_pct']:>6}%")

        if args.dry_run:
            print("\n(dry-run : aucune écriture en base)")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
