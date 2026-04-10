/**
 * Legitimate Domain Registry Sync
 *
 * Populates the legitimate_domains table from two sources:
 *
 *   whitelist — Rotterdam Port Whitelist entries that carry an official website URL.
 *               Extracted from fraud_alerts WHERE list_type='whitelist' AND scam_url IS NOT NULL.
 *               scam_url in the whitelist context holds the company's *official* website.
 *
 *   manual    — Curated list of major global energy traders, oil majors, and tank terminal
 *               operators whose domains are commonly impersonated in energy trade fraud.
 *
 * Run via: POST /api/admin/sync { source: "legitdomains" }
 * or as part of: POST /api/admin/sync { source: "all" }
 */

import { db } from '@/lib/server/db'
import { extractDomain } from '@/lib/server/domain-check'

// ── Company name normalization ────────────────────────────────────────────────
// Strips legal suffixes and generic words to produce a stable normalized name
// suitable for fuzzy matching.

const LEGAL_SUFFIXES =
  /\b(sa|sarl|sas|srl|spa|sl|se|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|pte|fze|fzco|llc|llp|plc|as|asa|ab|oy|aps|pvt|jsc|ojsc|ooo|pjsc)\b\.?/gi

const GENERIC_WORDS =
  /\b(energy|trading|marine|maritime|shipping|petroleum|oil|gas|lng|lpg|commodities|cargo|logistics|services|solutions|resources|group|holdings|holding|international|management|investment|capital|finance|financial|partners|ventures|enterprise|enterprises|bunker|bunkering)\b/gi

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(GENERIC_WORDS, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Manual seed ───────────────────────────────────────────────────────────────
// Major energy traders, oil majors, and terminal operators whose domains are
// commonly cloned or typosquatted in storage-spoofing and fuel-scam fraud.

interface SeedEntry {
  domain: string
  company_name: string
  country_code: string | null
}

const MANUAL_SEED: SeedEntry[] = [
  // ── Global commodity traders ────────────────────────────────────────────
  { domain: 'vitol.com',                   company_name: 'Vitol Group',                          country_code: 'NL' },
  { domain: 'trafigura.com',               company_name: 'Trafigura',                            country_code: 'SG' },
  { domain: 'glencore.com',                company_name: 'Glencore',                             country_code: 'CH' },
  { domain: 'gunvorgroup.com',             company_name: 'Gunvor Group',                         country_code: 'CH' },
  { domain: 'mercuria.com',                company_name: 'Mercuria Energy',                      country_code: 'CH' },
  { domain: 'freepointcommodities.com',    company_name: 'Freepoint Commodities',                country_code: 'US' },
  { domain: 'litasco.com',                 company_name: 'Litasco SA',                           country_code: 'CH' },
  { domain: 'unipec.com',                  company_name: 'Unipec',                               country_code: 'CN' },
  { domain: 'castletoncommodities.com',    company_name: 'Castleton Commodities International',  country_code: 'US' },
  { domain: 'phibro.com',                  company_name: 'Phibro LLC',                           country_code: 'US' },
  // ── Oil majors ──────────────────────────────────────────────────────────
  { domain: 'shell.com',                   company_name: 'Shell',                                country_code: 'GB' },
  { domain: 'bp.com',                      company_name: 'BP',                                   country_code: 'GB' },
  { domain: 'exxonmobil.com',              company_name: 'ExxonMobil',                           country_code: 'US' },
  { domain: 'totalenergies.com',           company_name: 'TotalEnergies',                        country_code: 'FR' },
  { domain: 'chevron.com',                 company_name: 'Chevron',                              country_code: 'US' },
  { domain: 'equinor.com',                 company_name: 'Equinor',                              country_code: 'NO' },
  { domain: 'repsol.com',                  company_name: 'Repsol',                               country_code: 'ES' },
  { domain: 'eni.com',                     company_name: 'Eni',                                  country_code: 'IT' },
  { domain: 'conocophillips.com',          company_name: 'ConocoPhillips',                       country_code: 'US' },
  { domain: 'lukoil.com',                  company_name: 'Lukoil',                               country_code: 'RU' },
  { domain: 'rosneft.com',                 company_name: 'Rosneft',                              country_code: 'RU' },
  { domain: 'aramco.com',                  company_name: 'Saudi Aramco',                         country_code: 'SA' },
  { domain: 'adnoc.ae',                    company_name: 'ADNOC',                                country_code: 'AE' },
  { domain: 'kpc.com.kw',                  company_name: 'Kuwait Petroleum Corporation',         country_code: 'KW' },
  { domain: 'petronas.com',                company_name: 'Petronas',                             country_code: 'MY' },
  { domain: 'petrobras.com.br',            company_name: 'Petrobras',                            country_code: 'BR' },
  { domain: 'sinopec.com',                 company_name: 'Sinopec',                              country_code: 'CN' },
  { domain: 'cnpc.com.cn',                 company_name: 'CNPC',                                 country_code: 'CN' },
  { domain: 'cnooc.com.cn',                company_name: 'CNOOC',                                country_code: 'CN' },
  { domain: 'nayaraenergy.com',            company_name: 'Nayara Energy',                        country_code: 'IN' },
  { domain: 'ril.com',                     company_name: 'Reliance Industries',                  country_code: 'IN' },
  { domain: 'iocl.com',                    company_name: 'Indian Oil Corporation',               country_code: 'IN' },
  // ── Bunker & marine fuel ────────────────────────────────────────────────
  { domain: 'wfscorp.com',                 company_name: 'World Fuel Services',                  country_code: 'US' },
  { domain: 'bunker-holding.com',          company_name: 'Bunker Holding',                       country_code: 'DK' },
  { domain: 'bomin.com',                   company_name: 'Bomin Bunker Oil',                     country_code: 'DE' },
  { domain: 'mabanaft.com',                company_name: 'Mabanaft',                             country_code: 'DE' },
  { domain: 'pumaenergy.com',              company_name: 'Puma Energy',                          country_code: 'SG' },
  { domain: 'peninsulapetroleumgroup.com', company_name: 'Peninsula Petroleum',                  country_code: 'IE' },
  { domain: 'chemoil.com',                 company_name: 'Chemoil',                              country_code: 'SG' },
  { domain: 'vivoenergy.com',              company_name: 'Vivo Energy',                          country_code: 'GB' },
  // ── Additional commodity traders ────────────────────────────────────────
  { domain: 'kochsupplyandtrading.com',    company_name: 'Koch Supply & Trading',                country_code: 'US' },
  { domain: 'bunge.com',                   company_name: 'Bunge',                                country_code: 'US' },
  { domain: 'cargill.com',                 company_name: 'Cargill',                              country_code: 'US' },
  { domain: 'ldc.com',                     company_name: 'Louis Dreyfus Company',                country_code: 'NL' },
  { domain: 'socartrading.com',            company_name: 'SOCAR Trading',                        country_code: 'CH' },
  { domain: 'freeportlng.com',             company_name: 'Freeport LNG',                         country_code: 'US' },
  { domain: 'trafi.com',                   company_name: 'Trafi',                                country_code: 'LT' },
  // ── Additional NOCs & regional majors ───────────────────────────────────
  { domain: 'qatarenergy.com',             company_name: 'QatarEnergy',                          country_code: 'QA' },
  { domain: 'oq.com',                      company_name: 'OQ (Oman Oil)',                        country_code: 'OM' },
  { domain: 'socar.az',                    company_name: 'SOCAR',                                country_code: 'AZ' },
  { domain: 'pttplc.com',                  company_name: 'PTT',                                  country_code: 'TH' },
  { domain: 'pertamina.com',               company_name: 'Pertamina',                            country_code: 'ID' },
  { domain: 'omv.com',                     company_name: 'OMV',                                  country_code: 'AT' },
  { domain: 'galp.com',                    company_name: 'Galp',                                 country_code: 'PT' },
  { domain: 'orlen.pl',                    company_name: 'PKN Orlen',                            country_code: 'PL' },
  { domain: 'mol.hu',                      company_name: 'MOL Group',                            country_code: 'HU' },
  { domain: 'enoc.com',                    company_name: 'Emirates National Oil Company',        country_code: 'AE' },
  { domain: 'bharatpetroleum.com',         company_name: 'Bharat Petroleum',                    country_code: 'IN' },
  { domain: 'hindustanpetroleum.com',      company_name: 'Hindustan Petroleum',                  country_code: 'IN' },
  { domain: 'pttep.com',                   company_name: 'PTTEP',                                country_code: 'TH' },
  { domain: 'ypf.com',                     company_name: 'YPF',                                  country_code: 'AR' },
  { domain: 'ecopetrol.com.co',            company_name: 'Ecopetrol',                            country_code: 'CO' },
  // ── Additional bunker & marine fuel ─────────────────────────────────────
  { domain: 'monjasa.com',                 company_name: 'Monjasa',                              country_code: 'DK' },
  { domain: 'minervabunkering.com',        company_name: 'Minerva Bunkering',                    country_code: 'US' },
  { domain: 'cockettmarine.com',           company_name: 'Cockett Marine Oil',                   country_code: 'GB' },
  { domain: 'integr8fuels.com',            company_name: 'Integr8 Fuels',                        country_code: 'GB' },
  { domain: 'tfgmarine.com',               company_name: 'TFG Marine',                           country_code: 'SG' },
  { domain: 'falenergy.com',               company_name: 'FAL Energy',                           country_code: 'AE' },
  { domain: 'glander-international.com',   company_name: 'Glander International Bunkering',      country_code: 'DE' },
  { domain: 'mcleanswatson.com',           company_name: 'McLeans Watson',                       country_code: 'SG' },
  // ── Tank terminals & storage ─────────────────────────────────────────────
  { domain: 'vopak.com',                   company_name: 'Vopak',                                country_code: 'NL' },
  { domain: 'oiltanking.com',              company_name: 'Oiltanking',                           country_code: 'DE' },
  { domain: 'vtti.com',                    company_name: 'VTTI',                                 country_code: 'NL' },
  { domain: 'stolt-nielsen.com',           company_name: 'Stolt-Nielsen',                        country_code: 'GB' },
  { domain: 'standic.com',                 company_name: 'Standic',                              country_code: 'NL' },
  { domain: 'oiltankinggroup.com',         company_name: 'Oiltanking Group',                     country_code: 'DE' },
  { domain: 'odfjell.com',                 company_name: 'Odfjell',                              country_code: 'NO' },
  { domain: 'nustarenergy.com',            company_name: 'NuStar Energy',                        country_code: 'US' },
  { domain: 'kindermorgan.com',            company_name: 'Kinder Morgan',                        country_code: 'US' },
  { domain: 'horizonterminals.com',        company_name: 'Horizon Terminals',                    country_code: 'AE' },
  { domain: 'broogepetroleum.com',         company_name: 'Brooge Energy',                        country_code: 'AE' },
  { domain: 'rubis-terminal.com',          company_name: 'Rubis Terminal',                       country_code: 'FR' },
  { domain: 'clh.es',                      company_name: 'CLH',                                  country_code: 'ES' },
  { domain: 'zenithenergy.com',            company_name: 'Zenith Energy',                        country_code: 'CA' },
  // ── Tanker operators ────────────────────────────────────────────────────
  { domain: 'euronav.com',                 company_name: 'Euronav',                              country_code: 'BE' },
  { domain: 'frontline.bm',               company_name: 'Frontline',                            country_code: 'BM' },
  { domain: 'hafnia.com',                  company_name: 'Hafnia',                               country_code: 'DK' },
  { domain: 'scorpiotankers.com',          company_name: 'Scorpio Tankers',                      country_code: 'MC' },
  { domain: 'bwgroup.com',                 company_name: 'BW Group',                             country_code: 'SG' },
  { domain: 'tenn.gr',                     company_name: 'Tsakos Energy Navigation',             country_code: 'GR' },
  { domain: 'dhtankers.com',               company_name: 'DHT Holdings',                         country_code: 'BM' },
  { domain: 'ardmoreshipping.com',         company_name: 'Ardmore Shipping',                     country_code: 'IE' },
  { domain: 'thenamaris.com',              company_name: 'Thenamaris',                           country_code: 'GR' },
  { domain: 'teekay.com',                  company_name: 'Teekay',                               country_code: 'BM' },
  { domain: 'aframax.com',                 company_name: 'Aframax International',                country_code: 'CY' },
  { domain: 'navig8group.com',             company_name: 'Navig8 Group',                         country_code: 'GB' },
  // ── NOCs & producers (Wikidata-verified, manually curated) ──────────────────
  { domain: 'yamalspg.ru',               company_name: 'Yamal LNG',                            country_code: 'RU' },
  { domain: 'sonelgaz.dz',               company_name: 'Sonelgaz',                             country_code: 'DZ' },
  { domain: 'chinagasholdings.com.hk',   company_name: 'China Gas Holdings',                   country_code: 'HK' },
  { domain: 'cegh.at',                   company_name: 'Central European Gas Hub',              country_code: 'AT' },
  { domain: 'depa.gr',                   company_name: 'DEPA',                                 country_code: 'GR' },
  { domain: 'petroreconcavo.com.br',     company_name: 'PetroReconcavo',                       country_code: 'BR' },
  { domain: 'ingl.co.il',               company_name: 'Israel Natural Gas Lines',              country_code: 'IL' },
  { domain: 'naturalgaschina.com',       company_name: 'China Natural Gas',                    country_code: 'CN' },
  { domain: 'gasstorage.dk',             company_name: 'Gas Storage Denmark',                  country_code: 'DK' },
  // ── Russia & CIS producers ───────────────────────────────────────────────────
  { domain: 'gazprom.ru',              company_name: 'Gazprom',                              country_code: 'RU' },
  { domain: 'novatek.ru',             company_name: 'Novatek',                              country_code: 'RU' },
  { domain: 'tatneft.ru',             company_name: 'Tatneft',                              country_code: 'RU' },
  { domain: 'surgutneftegas.ru',      company_name: 'Surgutneftegas',                       country_code: 'RU' },
  { domain: 'bashneft.com',           company_name: 'Bashneft',                             country_code: 'RU' },
  { domain: 'transneft.ru',           company_name: 'Transneft',                            country_code: 'RU' },
  { domain: 'naftogaz.com',           company_name: 'Naftogaz',                             country_code: 'UA' },
  { domain: 'kmg.kz',                 company_name: 'KazMunayGas',                          country_code: 'KZ' },
  { domain: 'sovcomflot.ru',          company_name: 'Sovcomflot',                           country_code: 'RU' },
  // ── Asian NOCs & major producers ────────────────────────────────────────────
  { domain: 'petrochina.com.cn',      company_name: 'PetroChina',                           country_code: 'CN' },
  { domain: 'sinopecgroup.com',       company_name: 'China Petrochemical Corporation',      country_code: 'CN' },
  { domain: 'ongcindia.com',          company_name: 'Oil and Natural Gas Corporation',      country_code: 'IN' },
  { domain: 'gailonline.com',         company_name: 'GAIL',                                 country_code: 'IN' },
  { domain: 'pvn.vn',                 company_name: 'Petrovietnam',                         country_code: 'VN' },
  { domain: 'knoc.co.kr',             company_name: 'Korea National Oil Corporation',       country_code: 'KR' },
  { domain: 'kogas.or.kr',            company_name: 'Korea Gas Corporation',                country_code: 'KR' },
  { domain: 'inpex.co.jp',            company_name: 'Inpex',                                country_code: 'JP' },
  { domain: 'eneos.co.jp',            company_name: 'ENEOS',                                country_code: 'JP' },
  { domain: 'cpc.com.tw',             company_name: 'CPC Corporation Taiwan',               country_code: 'TW' },
  { domain: 'tpao.gov.tr',            company_name: 'Turkish Petroleum Corporation',        country_code: 'TR' },
  { domain: 'medcoenergi.com',        company_name: 'MedcoEnergi',                          country_code: 'ID' },
  // ── Middle East NOCs (beyond those in oil majors section) ───────────────────
  { domain: 'bapco.net',              company_name: 'Bahrain Petroleum Company',            country_code: 'BH' },
  { domain: 'en.nioc.ir',             company_name: 'National Iranian Oil Company',         country_code: 'IR' },
  { domain: 'noc.ly',                 company_name: 'National Oil Corporation',             country_code: 'LY' },
  { domain: 'nakilat.com.qa',         company_name: 'Nakilat',                              country_code: 'QA' },
  { domain: 'q8.com',                 company_name: 'Kuwait Petroleum International',       country_code: 'KW' },
  // ── African NOCs ─────────────────────────────────────────────────────────────
  { domain: 'nnpcgroup.com',          company_name: 'Nigerian National Petroleum Corp',     country_code: 'NG' },
  { domain: 'sonangol.co.ao',         company_name: 'Sonangol',                             country_code: 'AO' },
  { domain: 'sonatrach.com',          company_name: 'Sonatrach',                            country_code: 'DZ' },
  { domain: 'agoco.com.ly',           company_name: 'Arabian Gulf Oil Company',             country_code: 'LY' },
  { domain: 'aiteogroup.com',         company_name: 'Aiteo',                                country_code: 'NG' },
  { domain: 'sasol.com',              company_name: 'Sasol',                                country_code: 'ZA' },
  // ── Americas NOCs & large independents ──────────────────────────────────────
  { domain: 'pemex.com',              company_name: 'Pemex',                                country_code: 'MX' },
  { domain: 'pdvsa.com',              company_name: 'PDVSA',                                country_code: 'VE' },
  { domain: 'ypfb.gob.bo',            company_name: 'YPFB',                                 country_code: 'BO' },
  { domain: 'enap.cl',                company_name: 'Empresa Nacional del Petróleo',        country_code: 'CL' },
  { domain: 'suncor.com',             company_name: 'Suncor Energy',                        country_code: 'CA' },
  { domain: 'cnrl.com',               company_name: 'Canadian Natural Resources',           country_code: 'CA' },
  { domain: 'cenovus.com',            company_name: 'Cenovus Energy',                       country_code: 'CA' },
  { domain: 'oxy.com',                company_name: 'Occidental Petroleum',                 country_code: 'US' },
  { domain: 'hess.com',               company_name: 'Hess Corporation',                     country_code: 'US' },
  { domain: 'marathonoil.com',        company_name: 'Marathon Oil',                         country_code: 'US' },
  { domain: 'enbridge.com',           company_name: 'Enbridge',                             country_code: 'CA' },
  { domain: 'tcenergy.com',           company_name: 'TC Energy',                            country_code: 'CA' },
  // ── Asia-Pacific major producers ─────────────────────────────────────────────
  { domain: 'bhp.com',                company_name: 'BHP Group',                            country_code: 'AU' },
  { domain: 'woodside.com',           company_name: 'Woodside Energy',                      country_code: 'AU' },
  { domain: 'santos.com',             company_name: 'Santos',                               country_code: 'AU' },
  // ── European producers & refiners ────────────────────────────────────────────
  { domain: 'wintershalldea.com',     company_name: 'Wintershall Dea',                      country_code: 'DE' },
  { domain: 'neste.com',              company_name: 'Neste',                                country_code: 'FI' },
  { domain: 'saras.it',               company_name: 'Saras',                                country_code: 'IT' },
  { domain: 'nis.rs',                 company_name: 'NIS',                                  country_code: 'RS' },
  { domain: 'rompetrol.com',          company_name: 'Rompetrol',                            country_code: 'RO' },
  { domain: 'lotos.pl',               company_name: 'Lotos Group',                          country_code: 'PL' },
  { domain: 'ina.hr',                 company_name: 'INA',                                  country_code: 'HR' },
  { domain: 'akerbp.com',             company_name: 'Aker BP',                              country_code: 'NO' },
  { domain: 'dno.no',                 company_name: 'DNO International',                    country_code: 'NO' },
  { domain: 'perenco.com',            company_name: 'Perenco',                              country_code: 'FR' },
  { domain: 'harbourenergy.com',      company_name: 'Harbour Energy',                       country_code: 'GB' },
  { domain: 'helpe.gr',               company_name: 'HELLENiQ ENERGY',                      country_code: 'GR' },
  { domain: 'moh.gr',                 company_name: 'Motor Oil Hellas',                      country_code: 'GR' },
  { domain: 'snam.it',                company_name: 'Snam',                                  country_code: 'IT' },
  { domain: 'edison.it',              company_name: 'Edison',                                country_code: 'IT' },
  { domain: 'erg.eu',                 company_name: 'ERG',                                   country_code: 'IT' },
  { domain: 'bgenh.com',              company_name: 'Bulgarian Energy Holding',              country_code: 'BG' },
  { domain: 'engie.com',              company_name: 'Engie',                                 country_code: 'FR' },
  { domain: 'centrica.com',           company_name: 'Centrica',                              country_code: 'GB' },
  // ── More Asian producers & refiners ─────────────────────────────────────────
  { domain: 'idemitsu.com',           company_name: 'Idemitsu Kosan',                       country_code: 'JP' },
  { domain: 'cosmo-oil.co.jp',        company_name: 'Cosmo Oil Company',                    country_code: 'JP' },
  { domain: 'gscaltex.com',           company_name: 'GS Caltex',                            country_code: 'KR' },
  { domain: 'skinnovation.com',       company_name: 'SK Innovation',                        country_code: 'KR' },
  { domain: 'thaioilgroup.com',       company_name: 'Thai Oil',                             country_code: 'TH' },
  { domain: 'fpcc.com.tw',            company_name: 'Formosa Petrochemical',                country_code: 'TW' },
  { domain: 'sxycpc.com',             company_name: 'Shaanxi Yanchang Petroleum',           country_code: 'CN' },
  { domain: 'cosl.com.cn',            company_name: 'China Oilfield Services',              country_code: 'CN' },
  // ── More Middle East ─────────────────────────────────────────────────────────
  { domain: 'pdo.co.om',              company_name: 'Petroleum Development Oman',           country_code: 'OM' },
  // ── Africa additions ─────────────────────────────────────────────────────────
  { domain: 'snpc-group.com',         company_name: 'Société Nationale des Pétroles du Congo', country_code: 'CG' },
  { domain: 'engen.co.za',            company_name: 'Engen Petroleum',                      country_code: 'ZA' },
  { domain: 'astronenergy.co.za',     company_name: 'Astron Energy',                        country_code: 'ZA' },
  { domain: 'naftal.dz',              company_name: 'Naftal',                               country_code: 'DZ' },
  // ── Latin America additions ──────────────────────────────────────────────────
  { domain: 'empresascopec.cl',       company_name: 'Empresas Copec',                       country_code: 'CL' },
  { domain: 'ipiranga.com.br',        company_name: 'Petroleo Ipiranga',                    country_code: 'BR' },
  { domain: 'ultra.com.br',           company_name: 'Ultrapar',                             country_code: 'BR' },
  // ── Canada additions ─────────────────────────────────────────────────────────
  { domain: 'tourmalineoil.com',      company_name: 'Tourmaline Oil',                       country_code: 'CA' },
  { domain: 'altagas.ca',             company_name: 'AltaGas',                              country_code: 'CA' },
  { domain: 'arcresources.com',       company_name: 'ARC Resources',                        country_code: 'CA' },
  { domain: 'imperialoil.ca',         company_name: 'Imperial Oil',                         country_code: 'CA' },
  { domain: 'irvingoil.com',          company_name: 'Irving Oil',                           country_code: 'CA' },
  { domain: 'gibsonenergy.com',       company_name: 'Gibson Energy',                        country_code: 'CA' },
  { domain: 'enerplus.com',           company_name: 'Enerplus',                             country_code: 'CA' },
  { domain: 'dana-petroleum.com',     company_name: 'Dana Petroleum',                       country_code: 'GB' },
  { domain: 'bluenord.com',           company_name: 'BlueNord',                             country_code: 'NO' },
  { domain: 'lundin-energy.com',      company_name: 'Lundin Energy',                        country_code: 'SE' },
  { domain: 'tullowoil.com',          company_name: 'Tullow Oil',                           country_code: 'GB' },
  { domain: 'orsted.com',             company_name: 'Ørsted',                               country_code: 'DK' },
  { domain: 'moeveglobal.com',        company_name: 'Moeve',                                country_code: 'ES' },
  { domain: 'tupras.com.tr',          company_name: 'Tüpraş',                               country_code: 'TR' },
  { domain: 'makpetrol.com.mk',       company_name: 'Makpetrol',                            country_code: 'MK' },
  // ── Central Asia & Caucasus ──────────────────────────────────────────────────
  { domain: 'ung.uz',                 company_name: 'Uzbekneftegaz',                        country_code: 'UZ' },
  { domain: 'sakhalinenergy.com',     company_name: 'Sakhalin Energy',                      country_code: 'RU' },
  { domain: 'eng.russneft.ru',        company_name: 'Russneft',                             country_code: 'RU' },
  { domain: 'naftiran.com',           company_name: 'Naftiran Intertrade',                  country_code: 'CH' },
  { domain: 'nisoc.ir',               company_name: 'National Iranian South Oil Company',   country_code: 'IR' },
  // ── South & Southeast Asia NOCs ─────────────────────────────────────────────
  { domain: 'japex.co.jp',            company_name: 'JAPEX',                                country_code: 'JP' },
  { domain: 'oilindia.nic.in',        company_name: 'Oil India',                            country_code: 'IN' },
  { domain: 'petrobangla.org.bd',     company_name: 'Petrobangla',                          country_code: 'BD' },
  { domain: 'ppl.com.pk',             company_name: 'Pakistan Petroleum',                   country_code: 'PK' },
  { domain: 'psopk.com',              company_name: 'Pakistan State Oil',                   country_code: 'PK' },
  { domain: 'petron.com',             company_name: 'Petron Corporation',                   country_code: 'PH' },
  { domain: 'pnoc.com.ph',            company_name: 'Philippine National Oil Company',      country_code: 'PH' },
  { domain: 'vietsov.com.vn',         company_name: 'Vietsovpetro',                         country_code: 'VN' },
  { domain: 'spc.com.sg',             company_name: 'Singapore Petroleum Company',          country_code: 'SG' },
  { domain: 'towngas.com',            company_name: 'HK & China Gas Company',               country_code: 'HK' },
  // ── Asia-Pacific additions ───────────────────────────────────────────────────
  { domain: 'originenergy.com.au',    company_name: 'Origin Energy',                        country_code: 'AU' },
  { domain: 'oilsearch.com',          company_name: 'Oil Search',                           country_code: 'PG' },
  // ── Latin America additions ──────────────────────────────────────────────────
  { domain: 'petroperu.com.pe',       company_name: 'Petroperú',                            country_code: 'PE' },
  { domain: 'fronteraenergy.ca',      company_name: 'Frontera Energy',                      country_code: 'CA' },
  // ── Africa additions ─────────────────────────────────────────────────────────
  { domain: 'petrosa.co.za',          company_name: 'PetroSA',                              country_code: 'ZA' },
  { domain: 'tpdc-tz.com',            company_name: 'Tanzania Petroleum Development Corp',  country_code: 'TZ' },
  // ── Canada additions ─────────────────────────────────────────────────────────
  { domain: 'pembina.com',            company_name: 'Pembina Pipeline',                     country_code: 'CA' },
  { domain: 'syncrude.ca',            company_name: 'Syncrude',                             country_code: 'CA' },
  // ── US additions ─────────────────────────────────────────────────────────────
  { domain: 'murphyoilcorp.com',      company_name: 'Murphy Oil',                           country_code: 'US' },
  { domain: 'valero.com',             company_name: 'Valero Energy',                        country_code: 'US' },
  { domain: 'nabors.com',             company_name: 'Nabors Industries',                    country_code: 'US' },
  { domain: 'xtoenergy.com',          company_name: 'XTO Energy',                           country_code: 'US' },
  // ── Offshore & drilling contractors ─────────────────────────────────────────
  { domain: 'sbmoffshore.com',        company_name: 'SBM Offshore',                         country_code: 'NL' },
  { domain: 'valaris.com',            company_name: 'Valaris',                              country_code: 'GB' },
  { domain: 'weatherford.com',        company_name: 'Weatherford International',            country_code: 'CH' },
  // ── More NOCs & regional producers ──────────────────────────────────────────
  { domain: 'ancap.com.uy',           company_name: 'ANCAP',                                country_code: 'UY' },
  { domain: 'eppetroecuador.ec',      company_name: 'EP Petroecuador',                      country_code: 'EC' },
  { domain: 'belneftekhim.by',        company_name: 'Belneftekhim',                         country_code: 'BY' },
  { domain: 'gspcgroup.com',          company_name: 'Gujarat State Petroleum Corporation',  country_code: 'IN' },
  { domain: 'cairnindia.com',         company_name: 'Cairn India',                          country_code: 'IN' },
  { domain: 'calikenerji.com.tr',     company_name: 'Çalık Enerji',                         country_code: 'TR' },
  { domain: 'citicresources.com',     company_name: 'CITIC Resources',                      country_code: 'HK' },
  { domain: 'energy.coscoshipping.com', company_name: 'COSCO SHIPPING Energy Transportation', country_code: 'CN' },
  { domain: 'bahri.sa',               company_name: 'National Shipping Company of Saudi Arabia', country_code: 'SA' },
  { domain: 'bazan.co.il',            company_name: 'Bazan Group',                          country_code: 'IL' },
  // ── Drilling contractors ─────────────────────────────────────────────────────
  { domain: 'deepwater.com',          company_name: 'Transocean',                           country_code: 'CH' },
  // ── US major E&P ─────────────────────────────────────────────────────────────
  { domain: 'apachecorp.com',          company_name: 'APA Corporation',                      country_code: 'US' },
  { domain: 'anteroresources.com',    company_name: 'Antero Resources',                     country_code: 'US' },
  { domain: 'clr.com',                company_name: 'Continental Resources',                country_code: 'US' },
  { domain: 'cnx.com',                company_name: 'CNX Resources',                        country_code: 'US' },
  { domain: 'cabotog.com',            company_name: 'Coterra Energy',                       country_code: 'US' },
  { domain: 'chk.com',               company_name: 'Expand Energy',                        country_code: 'US' },
  { domain: 'hollyfrontier.com',      company_name: 'HF Sinclair',                          country_code: 'US' },
  { domain: 'eogresources.com',       company_name: 'EOG Resources',                        country_code: 'US' },
  { domain: 'devonenergy.com',        company_name: 'Devon Energy',                         country_code: 'US' },
  { domain: 'diamondbackenergy.com',  company_name: 'Diamondback Energy',                   country_code: 'US' },
  { domain: 'eqt.com',               company_name: 'EQT Corporation',                      country_code: 'US' },
  { domain: 'rangeresources.com',     company_name: 'Range Resources',                      country_code: 'US' },
  { domain: 'talosenergy.com',        company_name: 'Talos Energy',                         country_code: 'US' },
  { domain: 'targaresources.com',     company_name: 'Targa Resources',                      country_code: 'US' },
  { domain: 'plainsallamerican.com',  company_name: 'Plains All American Pipeline',         country_code: 'US' },
  // ── More oilfield services ────────────────────────────────────────────────────
  { domain: 'nov.com',                company_name: 'National Oilwell Varco',               country_code: 'US' },
  { domain: 'subsea7.com',            company_name: 'Subsea 7',                             country_code: 'GB' },
  { domain: 'woodplc.com',            company_name: 'John Wood Group',                      country_code: 'GB' },
  // ── Oilfield services (appear in trade & inspection documents) ───────────────
  { domain: 'slb.com',                company_name: 'SLB (Schlumberger)',                   country_code: 'US' },
  { domain: 'halliburton.com',        company_name: 'Halliburton',                          country_code: 'US' },
  { domain: 'bakerhughes.com',        company_name: 'Baker Hughes',                         country_code: 'US' },
  { domain: 'saipem.com',             company_name: 'Saipem',                               country_code: 'IT' },
  { domain: 'technipfmc.com',         company_name: 'TechnipFMC',                           country_code: 'GB' },
  { domain: 'petrofac.com',           company_name: 'Petrofac',                             country_code: 'GB' },
  // ── US midstream & refining ──────────────────────────────────────────────────
  { domain: 'marathonpetroleum.com',  company_name: 'Marathon Petroleum',                   country_code: 'US' },
  { domain: 'phillips66.com',         company_name: 'Phillips 66',                          country_code: 'US' },
  { domain: 'sunoco.com',             company_name: 'Sunoco',                               country_code: 'US' },
  { domain: 'enterpriseproducts.com', company_name: 'Enterprise Products',                  country_code: 'US' },
  { domain: 'oneok.com',              company_name: 'ONEOK',                                country_code: 'US' },
  { domain: 'williams.com',           company_name: 'Williams Companies',                   country_code: 'US' },
  { domain: 'cheniere.com',           company_name: 'Cheniere Energy',                      country_code: 'US' },
  // ── Inspection & certification bodies ───────────────────────────────────
  { domain: 'bureauveritas.com',           company_name: 'Bureau Veritas',                       country_code: 'FR' },
  { domain: 'lr.org',                      company_name: "Lloyd's Register",                     country_code: 'GB' },
  { domain: 'dnv.com',                     company_name: 'DNV',                                  country_code: 'NO' },
  { domain: 'sgs.com',                     company_name: 'SGS',                                  country_code: 'CH' },
  { domain: 'intertek.com',               company_name: 'Intertek',                             country_code: 'GB' },
  { domain: 'abs.org',                     company_name: 'American Bureau of Shipping',          country_code: 'US' },
  { domain: 'rina.org',                    company_name: 'RINA',                                 country_code: 'IT' },
  { domain: 'classnk.or.jp',              company_name: 'ClassNK',                              country_code: 'JP' },
]

// ── Wikidata SPARQL import ────────────────────────────────────────────────────
// Queries Wikidata for energy-sector companies that have an official website URL.
// Focuses on oil companies, national oil companies, and petroleum-industry firms.
// Runs as part of syncLegitDomains() with a 30-second timeout.

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql'

// SPARQL query: oil companies + NOCs + petroleum-industry companies with websites
// Uses direct P31 (instance of) and P452 (industry) to avoid expensive path queries.
const WIKIDATA_ENERGY_QUERY = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryCode WHERE {
  {
    ?company wdt:P31 wd:Q35790 .
  } UNION {
    ?company wdt:P31 wd:Q2348054 .
  } UNION {
    ?company wdt:P452 wd:Q130901 .
  } UNION {
    ?company wdt:P452 wd:Q40858 .
  }
  ?company wdt:P856 ?website .
  OPTIONAL { ?company wdt:P17 ?country . ?country wdt:P297 ?countryCode . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 1000
`.trim()

interface WikidataBinding {
  companyLabel?: { value: string }
  website?:      { value: string }
  countryCode?:  { value: string }
}

async function syncFromWikidata(): Promise<SeedEntry[]> {
  const url = new URL(WIKIDATA_SPARQL_URL)
  url.searchParams.set('query', WIKIDATA_ENERGY_QUERY)
  url.searchParams.set('format', 'json')

  const res = await fetch(url.toString(), {
    headers: {
      'Accept':     'application/sparql-results+json',
      'User-Agent': 'EnergyTradeInspection/1.0 (https://etiverify.com)',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ${res.status}: ${res.statusText}`)
  }

  const data = await res.json() as { results: { bindings: WikidataBinding[] } }
  const entries: SeedEntry[] = []
  const seen = new Set<string>()

  for (const b of data.results.bindings) {
    const websiteUrl  = b.website?.value
    const companyName = b.companyLabel?.value
    if (!websiteUrl || !companyName) continue
    // Skip Wikidata auto-generated labels like "Q12345"
    if (/^Q\d+$/.test(companyName)) continue

    const domain = extractDomain(websiteUrl)
    if (!domain || domain.length < 4) continue
    if (seen.has(domain)) continue
    seen.add(domain)

    const rawCode = b.countryCode?.value ?? null
    const countryCode = rawCode && rawCode.length === 2 ? rawCode.toUpperCase() : null

    entries.push({ domain, company_name: companyName, country_code: countryCode })
  }

  return entries
}

// ── Rotterdam whitelist import ────────────────────────────────────────────────

interface WhitelistRow {
  company_name: string
  scam_url: string  // in whitelist context, this is the company's official website
}

async function loadFromWhitelist(): Promise<SeedEntry[]> {
  const { rows } = await db.query<WhitelistRow>(
    `SELECT company_name, scam_url
     FROM fraud_alerts
     WHERE list_type = 'whitelist'
       AND scam_url IS NOT NULL
       AND scam_url != ''`
  )

  const entries: SeedEntry[] = []
  for (const row of rows) {
    const domain = extractDomain(row.scam_url)
    if (!domain || domain.length < 4) continue
    entries.push({
      domain,
      company_name: row.company_name,
      country_code: null,  // Rotterdam whitelist doesn't carry country
    })
  }
  return entries
}

// ── Database upsert ───────────────────────────────────────────────────────────

// Source precedence: manual (3) > wikidata (2) > whitelist (1)
const SOURCE_PRIORITY: Record<string, number> = { manual: 3, wikidata: 2, whitelist: 1 }

async function upsertLegitDomains(
  entries: Array<SeedEntry & { source: 'whitelist' | 'manual' | 'wikidata'; source_url: string | null }>
): Promise<number> {
  if (entries.length === 0) return 0

  // Deduplicate by domain — higher-priority source wins
  const seen = new Map<string, typeof entries[0]>()
  for (const e of entries) {
    const existing = seen.get(e.domain)
    const priority = SOURCE_PRIORITY[e.source] ?? 0
    const existingPriority = existing ? (SOURCE_PRIORITY[existing.source] ?? 0) : -1
    if (priority > existingPriority) {
      seen.set(e.domain, e)
    }
  }
  const deduped = [...seen.values()]

  const BATCH = 50
  let inserted = 0

  for (let i = 0; i < deduped.length; i += BATCH) {
    const batch = deduped.slice(i, i + BATCH)
    const placeholders = batch
      .map((_, j) => {
        const b = j * 6
        return `($${b+1},$${b+2},$${b+3},$${b+4}::char(2),$${b+5},$${b+6}::text,NOW())`
      })
      .join(',')

    await db.query(
      `INSERT INTO legitimate_domains
         (domain, company_name, normalized_name, country_code, source, source_url, synced_at)
       VALUES ${placeholders}
       ON CONFLICT (domain) DO UPDATE SET
         company_name    = EXCLUDED.company_name,
         normalized_name = EXCLUDED.normalized_name,
         country_code    = COALESCE(EXCLUDED.country_code, legitimate_domains.country_code),
         source          = EXCLUDED.source,
         source_url      = EXCLUDED.source_url,
         synced_at       = NOW()`,
      batch.flatMap((e) => [
        e.domain,
        e.company_name,
        normalizeName(e.company_name),
        e.country_code,
        e.source,
        e.source_url,
      ])
    )
    inserted += batch.length
  }

  return inserted
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LegitDomainsSyncResult {
  fromWhitelist: number
  fromManual: number
  fromWikidata: number
  total: number
  durationMs: number
}

/**
 * Sync legitimate domains from three sources:
 *   1. Rotterdam whitelist (fraud_alerts WHERE list_type='whitelist')
 *   2. Wikidata SPARQL — oil companies, NOCs, petroleum-industry firms
 *   3. Manual seed — curated major energy traders and oil majors
 *
 * Precedence on conflict: manual > wikidata > whitelist.
 * Safe to call repeatedly — uses ON CONFLICT upsert.
 */
export async function syncLegitDomains(): Promise<LegitDomainsSyncResult> {
  const start = Date.now()

  const [whitelistEntries, wikidataEntries] = await Promise.all([
    loadFromWhitelist().catch(() => [] as SeedEntry[]),
    syncFromWikidata().catch(() => [] as SeedEntry[]),
  ])

  const tagged = [
    ...whitelistEntries.map((e) => ({ ...e, source: 'whitelist' as const, source_url: null })),
    ...wikidataEntries.map((e) => ({ ...e, source: 'wikidata'  as const, source_url: null })),
    ...MANUAL_SEED.map((e)     => ({ ...e, source: 'manual'    as const, source_url: null })),
  ]

  const total = await upsertLegitDomains(tagged)

  return {
    fromWhitelist: whitelistEntries.length,
    fromManual:    MANUAL_SEED.length,
    fromWikidata:  wikidataEntries.length,
    total,
    durationMs: Date.now() - start,
  }
}
