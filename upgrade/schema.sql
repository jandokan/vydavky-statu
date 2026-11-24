-- D1 schéma pre platenú verziu (celá história CRZ, vyhľadávanie).
-- Vytvorenie:  npx wrangler d1 execute vydavky-statu --remote --file=upgrade/schema.sql
CREATE TABLE IF NOT EXISTS zmluvy (
  id INTEGER PRIMARY KEY,
  cislo TEXT, objednavatel TEXT, objednavatel_ico TEXT, objednavatel_adresa TEXT,
  dodavatel TEXT, dodavatel_ico TEXT, dodavatel_adresa TEXT,
  predmet TEXT, popis TEXT, popis_predmetu TEXT, poznamka TEXT, poznamka_zmena TEXT, interna_poznamka TEXT, text_ucinnost TEXT,
  datum_podpisu TEXT, datum_ucinnosti TEXT, platnost_do TEXT, zverejnene TEXT, zmenene TEXT,
  suma REAL, suma_spolu REAL, stav INTEGER, typ INTEGER, druh INTEGER, zdroj INTEGER, rezort INTEGER,
  interne_id TEXT, referencia TEXT, obstaravanie TEXT, potvrdenie TEXT, potvrdenie_datum TEXT, zmeny TEXT,
  prilohy TEXT,            -- JSON pole príloh
  miesto_o TEXT, miesto_d TEXT
);
CREATE INDEX IF NOT EXISTS ix_zverejnene ON zmluvy(zverejnene);
CREATE INDEX IF NOT EXISTS ix_obj_ico ON zmluvy(objednavatel_ico);
CREATE INDEX IF NOT EXISTS ix_dod_ico ON zmluvy(dodavatel_ico);
CREATE INDEX IF NOT EXISTS ix_miesto_o ON zmluvy(miesto_o);
CREATE INDEX IF NOT EXISTS ix_miesto_d ON zmluvy(miesto_d);
