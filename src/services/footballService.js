import fs from 'fs';
import path from 'path';
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';

const CACHE_FILE_PATH = path.resolve(process.cwd(), 'data/barca_fixtures.json');

// Cache for live API matches and last sync metadata
let apiMatchesCache = [];
let lastSyncTimestamp = null;
let lastSyncStatus = 'Never synced';
let lastSyncError = null;

// Initialize cache from disk if available
try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
        const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            apiMatchesCache = parsed;
            lastSyncStatus = `Loaded ${parsed.length} fixtures from disk cache`;
            logger.info(`[Football API] Initialized ${parsed.length} fixtures from disk cache.`);
        }
    }
} catch (e) {
    logger.warn('[Football API] Could not read disk fixture cache:', e.message);
}

// Stadium venue dictionary with transport guides in English & Spanish
export const STADIUM_TRANSPORT_GUIDES = {
    'camp nou': {
        venueEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        venueEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Access Spotify Camp Nou via Barcelona Metro Line 3 (Les Corts or Palau Reial stations) or Line 5 (Collblanc or Badal stations). Multiple TMB bus lines (D20, H6, 7, 33, 54) also stop directly near the stadium access gates.",
        transportEs: "Para llegar al Spotify Camp Nou, toma el Metro de Barcelona Línea 3 (estaciones Les Corts o Palau Reial) o Línea 5 (estaciones Collblanc o Badal). Múltiples líneas de autobús TMB (D20, H6, 7, 33, 54) tienen paradas junto a las puertas del campo."
    },
    'estadi olímpic': {
        venueEn: 'Estadi Olímpic Lluís Companys (Montjuïc), Barcelona 🇪🇸',
        venueEs: 'Estadi Olímpic Lluís Companys (Montjuïc), Barcelona 🇪🇸',
        transportEn: "Take Metro L1/L3 to 'Espanya' station and use the Montjuïc escalators or free matchday shuttle buses directly from Maria Cristina & Plaza España to the stadium concourse.",
        transportEs: "Toma el Metro L1/L3 hasta la estación 'Espanya' y usa las escaleras mecánicas de Montjuïc o los autobuses lanzadera gratuitos de día de partido desde Maria Cristina y Plaza España."
    },
    'montjuïc': {
        venueEn: 'Estadi Olímpic Lluís Companys (Montjuïc), Barcelona 🇪🇸',
        venueEs: 'Estadi Olímpic Lluís Companys (Montjuïc), Barcelona 🇪🇸',
        transportEn: "Take Metro L1/L3 to 'Espanya' station and use the Montjuïc escalators or free matchday shuttle buses directly from Maria Cristina & Plaza España to the stadium concourse.",
        transportEs: "Toma el Metro L1/L3 hasta la estación 'Espanya' y usa las escaleras mecánicas de Montjuïc o los autobuses lanzadera gratuitos de día de partido desde Maria Cristina y Plaza España."
    },
    'bernabeu': {
        venueEn: 'Estadio Santiago Bernabéu, Madrid 🇪🇸',
        venueEs: 'Estadio Santiago Bernabéu, Madrid 🇪🇸',
        transportEn: "Located in the Chamartín district of Madrid. Take Madrid Metro Line 10 directly to 'Santiago Bernabéu' station. Alternatively, Cercanías commuter trains stop at Nuevos Ministerios (10 min walk).",
        transportEs: "Ubicado en el distrito de Chamartín en Madrid. Toma la Línea 10 del Metro de Madrid directamente a la estación 'Santiago Bernabéu'. También se puede llegar en tren de Cercanías hasta Nuevos Ministerios (10 min a pie)."
    },
    'mestalla': {
        venueEn: 'Estadio de Mestalla, Valencia 🇪🇸',
        venueEs: 'Estadio de Mestalla, Valencia 🇪🇸',
        transportEn: "For those traveling to Mestalla, the stadium is well-connected within the city. The easiest way to get there is via the Valencia Metro (Lines 3, 5, 7, and 9), getting off directly at the 'Aragón' station, which leaves you right next to the stadium.",
        transportEs: "Para quienes viajen a Mestalla, el estadio está muy bien conectado dentro de la ciudad. La forma más fácil de llegar es a través del Metro de Valencia (Líneas 3, 5, 7 y 9), bajando directamente en la estación 'Aragón', la cual te deja justo al lado del campo."
    },
    'metropolitano': {
        venueEn: 'Riyadh Air Metropolitano, Madrid 🇪🇸',
        venueEs: 'Riyadh Air Metropolitano, Madrid 🇪🇸',
        transportEn: "Take Madrid Metro Line 7 directly to 'Estadio Metropolitano' station. Alternatively, Line 2 (Las Rosas) or Line 5 (Canillejas) are within a 15-minute walk.",
        transportEs: "Toma la Línea 7 del Metro de Madrid directamente a la estación 'Estadio Metropolitano'. Como alternativa, la Línea 2 (Las Rosas) o la Línea 5 (Canillejas) quedan a 15 minutos a pie."
    },
    'san mamés': {
        venueEn: 'Estadio de San Mamés, Bilbao 🇪🇸',
        venueEs: 'Estadio de San Mamés, Bilbao 🇪🇸',
        transportEn: "San Mamés is in central Bilbao. Metro Bilbao Lines 1 and 2 stop at 'San Mamés' station, with direct access to the stadium concourse.",
        transportEs: "San Mamés está en el centro de Bilbao. El Metro de Bilbao (Líneas 1 y 2) para en la estación 'San Mamés', con acceso directo al estadio."
    },
    'san mames': {
        venueEn: 'Estadio de San Mamés, Bilbao 🇪🇸',
        venueEs: 'Estadio de San Mamés, Bilbao 🇪🇸',
        transportEn: "San Mamés is in central Bilbao. Metro Bilbao Lines 1 and 2 stop at 'San Mamés' station, with direct access to the stadium concourse.",
        transportEs: "San Mamés está en el centro de Bilbao. El Metro de Bilbao (Líneas 1 y 2) para en la estación 'San Mamés', con acceso directo al estadio."
    },
    'benito villamarín': {
        venueEn: 'Estadio Benito Villamarín, Sevilla 🇪🇸',
        venueEs: 'Estadio Benito Villamarín, Sevilla 🇪🇸',
        transportEn: "Located on Avenida de la Palmera in Seville. Take TUSSAM bus lines 1, 2, 3, 6, 34 or 37 directly to the stadium. Cercanías train station 'Virgen del Rocío' is 10 minutes walk away.",
        transportEs: "Situado en la Avenida de la Palmera en Sevilla. Toma las líneas de autobús TUSSAM 1, 2, 3, 6, 34 o 37 directamente al estadio. La estación de Cercanías 'Virgen del Rocío' queda a 10 minutos a pie."
    },
    'sánchez-pizjuán': {
        venueEn: 'Estadio Ramón Sánchez-Pizjuán, Sevilla 🇪🇸',
        venueEs: 'Estadio Ramón Sánchez-Pizjuán, Sevilla 🇪🇸',
        transportEn: "Located in the Nervión district of Seville. Take Metro Line 1 to 'Nervión' or 'Gran Plaza' stations. MetroCentro tram (T1) stops at San Bernardo.",
        transportEs: "Situado en el barrio de Nervión en Sevilla. Toma la Línea 1 del Metro hasta las estaciones 'Nervión' o 'Gran Plaza'. El tranvía MetroCentro (T1) para en San Bernardo."
    },
    'reale arena': {
        venueEn: 'Reale Arena (Anoeta), San Sebastián 🇪🇸',
        venueEs: 'Reale Arena (Anoeta), San Sebastián 🇪🇸',
        transportEn: "Take Euskotren directly to 'Anoeta' station in San Sebastián / Donostia, or Dbus city bus lines 17, 21, 26, 28 to the stadium.",
        transportEs: "Toma el Euskotren directamente hasta la estación 'Anoeta' en San Sebastián / Donostia, o los autobuses urbanos Dbus líneas 17, 21, 26, 28."
    },
    'montilivi': {
        venueEn: 'Estadi Montilivi, Girona 🇪🇸',
        venueEs: 'Estadi Montilivi, Girona 🇪🇸',
        transportEn: "Take Girona City Bus Line 8 directly to the 'Montilivi - UDG' stop right by the stadium. Free matchday shuttle buses operate from Girona Train Station.",
        transportEs: "Toma la línea 8 del autobús urbano de Girona hasta la parada 'Montilivi - UDG' junto al estadio. Hay autobuses lanzadera gratuitos desde la estación de tren en días de partido."
    },
    'ceramica': {
        venueEn: 'Estadio de la Cerámica, Vila-real 🇪🇸',
        venueEs: 'Estadio de la Cerámica, Vila-real 🇪🇸',
        transportEn: "Take Cercanías C6 train from Valencia or Castellón to 'Vila-real' station, then walk 15 minutes through the city center to the stadium.",
        transportEs: "Toma el tren de Cercanías C6 desde Valencia o Castellón hasta la estación 'Vila-real', y camina 15 minutos por el centro hasta el estadio."
    },
    'vallecas': {
        venueEn: 'Campo de Fútbol de Vallecas, Madrid 🇪🇸',
        venueEs: 'Campo de Fútbol de Vallecas, Madrid 🇪🇸',
        transportEn: "Take Madrid Metro Line 1 directly to 'Portazgo' station, which exits right in front of the stadium gates on Avenida de la Albufera.",
        transportEs: "Toma la Línea 1 del Metro de Madrid directamente a la estación 'Portazgo', con salida justo enfrente de los accesos del estadio."
    },
    'balaídos': {
        venueEn: 'Estadio Municipal de Balaídos, Vigo 🇪🇸',
        venueEs: 'Estadio Municipal de Balaídos, Vigo 🇪🇸',
        transportEn: "Take Vitrasa city bus lines C3, 4A, 4C, 7, 11, or 23 to Balaídos. Matchday special shuttle lines (F) operate from Plaza América.",
        transportEs: "Toma las líneas de autobús Vitrasa C3, 4A, 4C, 7, 11 o 23 hacia Balaídos. Operan líneas especiales de día de partido desde Plaza América."
    },
    'son moix': {
        venueEn: 'Estadi Mallorca Son Moix, Palma 🇪🇸',
        venueEs: 'Estadi Mallorca Son Moix, Palma 🇪🇸',
        transportEn: "Take EMT Palma bus lines 8, 33, or 20 to the stadium. Special matchday shuttle buses run from Plaza de España.",
        transportEs: "Toma las líneas 8, 33 o 20 de la EMT Palma. Salen autobuses lanzadera especiales en días de partido desde la Plaza de España."
    },
    'el sadar': {
        venueEn: 'Estadio El Sadar, Pamplona 🇪🇸',
        venueEs: 'Estadio El Sadar, Pamplona 🇪🇸',
        transportEn: "Take TCC Villavesa bus lines 1, 6, 9, or 11 to the stadium in Pamplona. Matchday Line R1 runs from city center.",
        transportEs: "Toma las líneas 1, 6, 9 u 11 de Villavesa hacia el estadio en Pamplona. La línea especial R1 opera desde el centro en días de partido."
    },
    'mendizorrotza': {
        venueEn: 'Estadio de Mendizorrotza, Vitoria-Gasteiz 🇪🇸',
        venueEs: 'Estadio de Mendizorrotza, Vitoria-Gasteiz 🇪🇸',
        transportEn: "Take TUVISA city bus lines 2 (Periférica) or 8 to Paseo de Cervantes in Vitoria-Gasteiz.",
        transportEs: "Toma las líneas 2 (Periférica) u 8 de TUVISA hasta el Paseo de Cervantes en Vitoria-Gasteiz."
    },
    'allianz arena': {
        venueEn: 'Allianz Arena, Munich 🇩🇪',
        venueEs: 'Allianz Arena, Múnich 🇩🇪',
        transportEn: "Take Munich U-Bahn Line U6 directly to 'Fröttmaning' station. Follow the lighted esplanade walk (approx. 10–15 minutes) to the turnstiles.",
        transportEs: "Toma la línea U6 del U-Bahn de Múnich directamente hasta la estación 'Fröttmaning'. Sigue la explanada iluminada (unos 10–15 minutos) hasta los tornos."
    }
};

// High-profile baseline season matches for 2026–2027 calendar (exact ESPN schedule)
export const DEFAULT_BARCELONA_MATCHES = [
    // --- AUGUST 2026 ---
    {
        id: 'barca-elche-2026-08-23',
        opponent: 'ELCHE CF',
        homeOrAway: 'away',
        title: 'ELCHE CF vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 1 / Jornada 1',
        kickoffUtc: '2026-08-23T15:30:00.000Z',
        kickoffEn: 'Sunday, August 23, 2026 – 3:30 PM EDT',
        kickoffEs: 'Domingo, 23 de agosto de 2026 – 21:30 CEST',
        locationEn: 'Estadio Manuel Martínez Valero, Elche 🇪🇸',
        locationEs: 'Estadio Manuel Martínez Valero, Elche 🇪🇸',
        transportEn: "Take local Elche bus lines E, F, or K directly to Martínez Valero stadium.",
        transportEs: "Toma las líneas E, F o K del autobús urbano de Elche directamente al estadio."
    },
    {
        id: 'barca-athletic-2026-08-27',
        opponent: 'ATHLETIC CLUB',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs ATHLETIC CLUB',
        competition: 'LaLiga',
        matchday: 'Matchday 2 / Jornada 2',
        kickoffUtc: '2026-08-27T15:00:00.000Z',
        kickoffEn: 'Thursday, August 27, 2026 – 3:00 PM EDT',
        kickoffEs: 'Jueves, 27 de agosto de 2026 – 21:00 CEST',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Access Spotify Camp Nou via Barcelona Metro Line 3 (Les Corts / Palau Reial) or Line 5 (Collblanc).",
        transportEs: "Llega al Spotify Camp Nou mediante el Metro de Barcelona Línea 3 (Les Corts / Palau Reial) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-rayo-2026-08-31',
        opponent: 'RAYO VALLECANO',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs RAYO VALLECANO',
        competition: 'LaLiga',
        matchday: 'Matchday 3 / Jornada 3',
        kickoffUtc: '2026-08-31T15:30:00.000Z',
        kickoffEn: 'Monday, August 31, 2026 – 3:30 PM EDT',
        kickoffEs: 'Lunes, 31 de agosto de 2026 – 21:30 CEST',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Access Spotify Camp Nou via Metro L3 (Les Corts) or L5 (Collblanc).",
        transportEs: "Llega al Spotify Camp Nou mediante el Metro L3 (Les Corts) o L5 (Collblanc)."
    },

    // --- SEPTEMBER 2026 ---
    {
        id: 'barca-valencia-2026-09-06',
        opponent: 'VALENCIA CF',
        homeOrAway: 'away',
        title: 'VALENCIA CF vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 4 / Jornada 4',
        kickoffUtc: '2026-09-06T10:15:00.000Z',
        kickoffEn: 'Sunday, September 6, 2026 – 10:15 AM EDT',
        kickoffEs: 'Domingo, 6 de septiembre de 2026 – 16:15 CEST',
        locationEn: 'Estadio de Mestalla, Valencia 🇪🇸',
        locationEs: 'Estadio de Mestalla, Valencia 🇪🇸',
        transportEn: "Take Valencia Metro (Lines 3, 5, 7, or 9) to 'Aragón' station.",
        transportEs: "Toma el Metro de Valencia (Líneas 3, 5, 7 o 9) hasta la estación 'Aragón'."
    },
    {
        id: 'barca-levante-2026-09-13',
        opponent: 'LEVANTE UD',
        homeOrAway: 'away',
        title: 'LEVANTE UD vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 5 / Jornada 5',
        kickoffUtc: '2026-09-13T18:00:00.000Z',
        kickoffEn: 'Sunday, September 13, 2026 – Time TBD',
        kickoffEs: 'Domingo, 13 de septiembre de 2026 – Hora por confirmar',
        locationEn: 'Estadio Ciutat de València, Valencia 🇪🇸',
        locationEs: 'Estadio Ciutat de València, Valencia 🇪🇸',
        transportEn: "Take Valencia Metro Line 3 or 9 to 'Machado' station.",
        transportEs: "Toma la Línea 3 o 9 del Metro de Valencia hasta la estación 'Machado'."
    },
    {
        id: 'barca-racing-2026-09-16',
        opponent: 'RACING SANTANDER',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs RACING SANTANDER',
        competition: 'LaLiga',
        matchday: 'Matchday 6 / Jornada 6',
        kickoffUtc: '2026-09-16T19:00:00.000Z',
        kickoffEn: 'Wednesday, September 16, 2026 – Time TBD',
        kickoffEs: 'Miércoles, 16 de septiembre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-sevilla-2026-09-20',
        opponent: 'SEVILLA FC',
        homeOrAway: 'away',
        title: 'SEVILLA FC vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 7 / Jornada 7',
        kickoffUtc: '2026-09-20T19:00:00.000Z',
        kickoffEn: 'Sunday, September 20, 2026 – Time TBD',
        kickoffEs: 'Domingo, 20 de septiembre de 2026 – Hora por confirmar',
        locationEn: 'Estadio Ramón Sánchez-Pizjuán, Sevilla 🇪🇸',
        locationEs: 'Estadio Ramón Sánchez-Pizjuán, Sevilla 🇪🇸',
        transportEn: "Take Seville Metro Line 1 to 'Nervión' station.",
        transportEs: "Toma la Línea 1 del Metro de Sevilla hasta la estación 'Nervión'."
    },

    // --- OCTOBER 2026 ---
    {
        id: 'barca-getafe-2026-10-11',
        opponent: 'GETAFE CF',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs GETAFE CF',
        competition: 'LaLiga',
        matchday: 'Matchday 8 / Jornada 8',
        kickoffUtc: '2026-10-11T18:00:00.000Z',
        kickoffEn: 'Sunday, October 11, 2026 – Time TBD',
        kickoffEs: 'Domingo, 11 de octubre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-realbetis-2026-10-18',
        opponent: 'REAL BETIS',
        homeOrAway: 'away',
        title: 'REAL BETIS vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 9 / Jornada 9',
        kickoffUtc: '2026-10-18T18:00:00.000Z',
        kickoffEn: 'Sunday, October 18, 2026 – Time TBD',
        kickoffEs: 'Domingo, 18 de octubre de 2026 – Hora por confirmar',
        locationEn: 'Estadio Benito Villamarín, Sevilla 🇪🇸',
        locationEs: 'Estadio Benito Villamarín, Sevilla 🇪🇸',
        transportEn: "TUSSAM bus lines 1, 2, 3, 6, 34, 37 directly to Benito Villamarín.",
        transportEs: "Autobuses TUSSAM líneas 1, 2, 3, 6, 34, 37 directamente al estadio."
    },
    {
        id: 'barca-realmadrid-clasico-2026-10-25',
        opponent: 'REAL MADRID',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs REAL MADRID (EL CLÁSICO)',
        competition: 'LaLiga',
        matchday: 'Matchday 10 / Jornada 10 (El Clásico)',
        kickoffUtc: '2026-10-25T20:00:00.000Z',
        kickoffEn: 'Sunday, October 25, 2026 – Time TBD',
        kickoffEs: 'Domingo, 25 de octubre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro L3 (Palau Reial) or L5 (Collblanc). Gates open 2 hours early.",
        transportEs: "Metro L3 (Palau Reial) o L5 (Collblanc). Las puertas abren 2 horas antes."
    },

    // --- NOVEMBER 2026 ---
    {
        id: 'barca-alaves-2026-11-01',
        opponent: 'DEPORTIVO ALAVÉS',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs DEPORTIVO ALAVÉS',
        competition: 'LaLiga',
        matchday: 'Matchday 11 / Jornada 11',
        kickoffUtc: '2026-11-01T17:00:00.000Z',
        kickoffEn: 'Sunday, November 1, 2026 – Time TBD',
        kickoffEs: 'Domingo, 1 de noviembre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-atletico-2026-11-08',
        opponent: 'ATLÉTICO DE MADRID',
        homeOrAway: 'away',
        title: 'ATLÉTICO DE MADRID vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 12 / Jornada 12',
        kickoffUtc: '2026-11-08T20:00:00.000Z',
        kickoffEn: 'Sunday, November 8, 2026 – Time TBD',
        kickoffEs: 'Domingo, 8 de noviembre de 2026 – Hora por confirmar',
        locationEn: 'Riyadh Air Metropolitano, Madrid 🇪🇸',
        locationEs: 'Riyadh Air Metropolitano, Madrid 🇪🇸',
        transportEn: "Take Madrid Metro Line 7 directly to 'Estadio Metropolitano' station.",
        transportEs: "Toma la Línea 7 del Metro de Madrid directamente a 'Estadio Metropolitano'."
    },
    {
        id: 'barca-villarreal-2026-11-22',
        opponent: 'VILLARREAL CF',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs VILLARREAL CF',
        competition: 'LaLiga',
        matchday: 'Matchday 13 / Jornada 13',
        kickoffUtc: '2026-11-22T17:00:00.000Z',
        kickoffEn: 'Sunday, November 22, 2026 – Time TBD',
        kickoffEs: 'Domingo, 22 de noviembre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-deportivo-2026-11-29',
        opponent: 'DEPORTIVO LA CORUÑA',
        homeOrAway: 'away',
        title: 'DEPORTIVO LA CORUÑA vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 14 / Jornada 14',
        kickoffUtc: '2026-11-29T18:00:00.000Z',
        kickoffEn: 'Sunday, November 29, 2026 – Time TBD',
        kickoffEs: 'Domingo, 29 de noviembre de 2026 – Hora por confirmar',
        locationEn: 'Estadio Abanca-Riazor, A Coruña 🇪🇸',
        locationEs: 'Estadio Abanca-Riazor, A Coruña 🇪🇸',
        transportEn: "Take Companía Tranvías urban buses 3, 7, 11, or 12 to Riazor.",
        transportEs: "Toma los autobuses urbanos 3, 7, 11 o 12 hasta Riazor."
    },

    // --- DECEMBER 2026 ---
    {
        id: 'barca-celtavigo-2026-12-06',
        opponent: 'CELTA VIGO',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs CELTA VIGO',
        competition: 'LaLiga',
        matchday: 'Matchday 15 / Jornada 15',
        kickoffUtc: '2026-12-06T18:00:00.000Z',
        kickoffEn: 'Sunday, December 6, 2026 – Time TBD',
        kickoffEs: 'Domingo, 6 de diciembre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-malaga-2026-12-13',
        opponent: 'MÁLAGA CF',
        homeOrAway: 'away',
        title: 'MÁLAGA CF vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 16 / Jornada 16',
        kickoffUtc: '2026-12-13T18:00:00.000Z',
        kickoffEn: 'Sunday, December 13, 2026 – Time TBD',
        kickoffEs: 'Domingo, 13 de diciembre de 2026 – Hora por confirmar',
        locationEn: 'Estadio La Rosaleda, Málaga 🇪🇸',
        locationEs: 'Estadio La Rosaleda, Málaga 🇪🇸',
        transportEn: "EMT Málaga bus lines 1, 2, 15, 17, or 20 directly to La Rosaleda.",
        transportEs: "Líneas de autobús EMT 1, 2, 15, 17 o 20 directamente a La Rosaleda."
    },
    {
        id: 'barca-realsociedad-2026-12-20',
        opponent: 'REAL SOCIEDAD',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs REAL SOCIEDAD',
        competition: 'LaLiga',
        matchday: 'Matchday 17 / Jornada 17',
        kickoffUtc: '2026-12-20T20:00:00.000Z',
        kickoffEn: 'Sunday, December 20, 2026 – Time TBD',
        kickoffEs: 'Domingo, 20 de diciembre de 2026 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },

    // --- JANUARY 2027 ---
    {
        id: 'barca-espanyol-2027-01-03',
        opponent: 'RCD ESPANYOL',
        homeOrAway: 'away',
        title: 'RCD ESPANYOL vs FC BARCELONA (DERBI BARCELONÍ)',
        competition: 'LaLiga',
        matchday: 'Matchday 18 / Jornada 18 (Derbi Barceloní)',
        kickoffUtc: '2027-01-03T18:00:00.000Z',
        kickoffEn: 'Sunday, January 3, 2027 – Time TBD',
        kickoffEs: 'Domingo, 3 de enero de 2027 – Hora por confirmar',
        locationEn: 'RCDE Stadium, Cornellà-El Prat 🇪🇸',
        locationEs: 'RCDE Stadium, Cornellà-El Prat 🇪🇸',
        transportEn: "Take FGC train to 'Cornellà Riera' station or Metro L5 to 'Cornellà Centre'.",
        transportEs: "Toma el tren FGC a 'Cornellà Riera' o Metro L5 a 'Cornellà Centre'."
    },
    {
        id: 'barca-osasuna-2027-01-10',
        opponent: 'CA OSASUNA',
        homeOrAway: 'away',
        title: 'CA OSASUNA vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 19 / Jornada 19',
        kickoffUtc: '2027-01-10T18:00:00.000Z',
        kickoffEn: 'Sunday, January 10, 2027 – Time TBD',
        kickoffEs: 'Domingo, 10 de enero de 2027 – Hora por confirmar',
        locationEn: 'Estadio El Sadar, Pamplona 🇪🇸',
        locationEs: 'Estadio El Sadar, Pamplona 🇪🇸',
        transportEn: "TCC Villavesa bus lines 1, 6, 9 or 11 to El Sadar in Pamplona.",
        transportEs: "Autobuses Villavesa líneas 1, 6, 9 u 11 a El Sadar."
    },
    {
        id: 'barca-elche-2027-01-17',
        opponent: 'ELCHE CF',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs ELCHE CF',
        competition: 'LaLiga',
        matchday: 'Matchday 20 / Jornada 20',
        kickoffUtc: '2027-01-17T18:00:00.000Z',
        kickoffEn: 'Sunday, January 17, 2027 – Time TBD',
        kickoffEs: 'Domingo, 17 de enero de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-alaves-2027-01-24',
        opponent: 'DEPORTIVO ALAVÉS',
        homeOrAway: 'away',
        title: 'DEPORTIVO ALAVÉS vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 21 / Jornada 21',
        kickoffUtc: '2027-01-24T18:00:00.000Z',
        kickoffEn: 'Sunday, January 24, 2027 – Time TBD',
        kickoffEs: 'Domingo, 24 de enero de 2027 – Hora por confirmar',
        locationEn: 'Estadio de Mendizorrotza, Vitoria-Gasteiz 🇪🇸',
        locationEs: 'Estadio de Mendizorrotza, Vitoria-Gasteiz 🇪🇸',
        transportEn: "TUVISA bus lines 2 or 8 to Paseo de Cervantes in Vitoria.",
        transportEs: "Autobuses TUVISA líneas 2 u 8 a Mendizorrotza."
    },
    {
        id: 'barca-valencia-2027-01-31',
        opponent: 'VALENCIA CF',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs VALENCIA CF',
        competition: 'LaLiga',
        matchday: 'Matchday 22 / Jornada 22',
        kickoffUtc: '2027-01-31T20:00:00.000Z',
        kickoffEn: 'Sunday, January 31, 2027 – Time TBD',
        kickoffEs: 'Domingo, 31 de enero de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },

    // --- FEBRUARY 2027 ---
    {
        id: 'barca-supercopa-atletico-2027-02-02',
        opponent: 'ATLÉTICO DE MADRID',
        homeOrAway: 'neutral',
        title: 'FC BARCELONA vs ATLÉTICO DE MADRID',
        competition: 'Supercopa de España',
        matchday: 'Semi-Final / Semifinal',
        kickoffUtc: '2027-02-02T19:00:00.000Z',
        kickoffEn: 'Tuesday, February 2, 2027 – Time TBD',
        kickoffEs: 'Martes, 2 de febrero de 2027 – Hora por confirmar',
        locationEn: 'King Abdullah Sports City, Jeddah 🇸🇦',
        locationEs: 'King Abdullah Sports City, Yeda 🇸🇦',
        transportEn: "Official shuttle buses from King Abdulaziz International Airport and central Jeddah.",
        transportEs: "Autobuses lanzadera desde el Aeropuerto de Yeda y el centro urbano."
    },
    {
        id: 'barca-atletico-2027-02-07',
        opponent: 'ATLÉTICO DE MADRID',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs ATLÉTICO DE MADRID',
        competition: 'LaLiga',
        matchday: 'Matchday 23 / Jornada 23',
        kickoffUtc: '2027-02-07T20:00:00.000Z',
        kickoffEn: 'Sunday, February 7, 2027 – Time TBD',
        kickoffEs: 'Domingo, 7 de febrero de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-villarreal-2027-02-14',
        opponent: 'VILLARREAL CF',
        homeOrAway: 'away',
        title: 'VILLARREAL CF vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 24 / Jornada 24',
        kickoffUtc: '2027-02-14T18:00:00.000Z',
        kickoffEn: 'Sunday, February 14, 2027 – Time TBD',
        kickoffEs: 'Domingo, 14 de febrero de 2027 – Hora por confirmar',
        locationEn: 'Estadio de la Cerámica, Vila-real 🇪🇸',
        locationEs: 'Estadio de la Cerámica, Vila-real 🇪🇸',
        transportEn: "Cercanías C6 train from Valencia to 'Vila-real' station.",
        transportEs: "Tren de Cercanías C6 a la estación 'Vila-real'."
    },
    {
        id: 'barca-levante-2027-02-21',
        opponent: 'LEVANTE UD',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs LEVANTE UD',
        competition: 'LaLiga',
        matchday: 'Matchday 25 / Jornada 25',
        kickoffUtc: '2027-02-21T18:00:00.000Z',
        kickoffEn: 'Sunday, February 21, 2027 – Time TBD',
        kickoffEs: 'Domingo, 21 de febrero de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-athletic-2027-02-28',
        opponent: 'ATHLETIC CLUB',
        homeOrAway: 'away',
        title: 'ATHLETIC CLUB vs FC BARCELONA',
        competition: 'LaLiga',
        matchday: 'Matchday 26 / Jornada 26',
        kickoffUtc: '2027-02-28T20:00:00.000Z',
        kickoffEn: 'Sunday, February 28, 2027 – Time TBD',
        kickoffEs: 'Domingo, 28 de febrero de 2027 – Hora por confirmar',
        locationEn: 'Estadio de San Mamés, Bilbao 🇪🇸',
        locationEs: 'Estadio de San Mamés, Bilbao 🇪🇸',
        transportEn: "Metro Bilbao Lines 1 & 2 to 'San Mamés' station.",
        transportEs: "Metro de Bilbao Líneas 1 y 2 hasta 'San Mamés'."
    },

    // --- MARCH 2027 ---
    {
        id: 'barca-realbetis-2027-03-07',
        opponent: 'REAL BETIS',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs REAL BETIS',
        competition: 'LaLiga',
        matchday: 'Matchday 27 / Jornada 27',
        kickoffUtc: '2027-03-07T18:00:00.000Z',
        kickoffEn: 'Sunday, March 7, 2027 – Time TBD',
        kickoffEs: 'Domingo, 7 de marzo de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    },
    {
        id: 'barca-deportivo-2027-03-14',
        opponent: 'DEPORTIVO LA CORUÑA',
        homeOrAway: 'home',
        title: 'FC BARCELONA vs DEPORTIVO LA CORUÑA',
        competition: 'LaLiga',
        matchday: 'Matchday 28 / Jornada 28',
        kickoffUtc: '2027-03-14T18:00:00.000Z',
        kickoffEn: 'Sunday, March 14, 2027 – Time TBD',
        kickoffEs: 'Domingo, 14 de marzo de 2027 – Hora por confirmar',
        locationEn: 'Spotify Camp Nou, Barcelona 🇪🇸',
        locationEs: 'Spotify Camp Nou, Barcelona 🇪🇸',
        transportEn: "Metro Line 3 (Les Corts) or Line 5 (Collblanc).",
        transportEs: "Metro Línea 3 (Les Corts) o Línea 5 (Collblanc)."
    }
];

/**
 * Calculates the exact Madrid timezone abbreviation (CET in winter, CEST in summer)
 */
export function getMadridTimezoneAbbr(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'CET';
    const utcDate = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const madridDate = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const diffHours = Math.round((madridDate - utcDate) / (1000 * 60 * 60));
    return diffHours === 2 ? 'CEST' : 'CET';
}

/**
 * Formats a Date object into bilingual readable strings in Spanish and English using Europe/Madrid and America/New_York timezones
 */
export function formatBilingualDateTimes(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
        return {
            en: 'Date & Time TBA',
            es: 'Fecha y hora por confirmar'
        };
    }

    const tzMadrid = getMadridTimezoneAbbr(d);

    // Spanish formatting (Europe/Madrid)
    const dayNameEsRaw = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(d);
    const dayNameEs = dayNameEsRaw.charAt(0).toUpperCase() + dayNameEsRaw.slice(1);
    const monthNameEs = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', month: 'long' }).format(d);
    const dayNumEs = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric' }).format(d);
    const yearEs = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(d);
    const hour24Madrid = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hour: 'numeric', hour12: false }).format(d), 10);
    const minStrMadrid = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', minute: '2-digit' }).format(d).padStart(2, '0');
    const timeEs = `${hour24Madrid.toString().padStart(2, '0')}:${minStrMadrid} ${tzMadrid}`;

    // English formatting (America/New_York - EDT / EST)
    const dayNameEn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(d);
    const monthNameEn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long' }).format(d);
    const dayNumEn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', day: 'numeric' }).format(d);
    const yearEn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(d);
    const hour24Ny = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(d), 10);
    const minStrNy = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: '2-digit' }).format(d).padStart(2, '0');
    const ampmNy = hour24Ny >= 12 ? 'PM' : 'AM';
    const hour12Ny = hour24Ny % 12 || 12;
    const nyTz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).format(d).split(' ').pop();
    const timeEn = `${hour12Ny}:${minStrNy} ${ampmNy} ${nyTz || 'EDT'}`;

    return {
        en: `${dayNameEn}, ${monthNameEn} ${dayNumEn}, ${yearEn} – ${timeEn}`,
        es: `${dayNameEs}, ${dayNumEs} de ${monthNameEs} de ${yearEs} – ${timeEs}`
    };
}

/**
 * Finds stadium transport directions for a given venue string or home/away context
 */
export function getStadiumInfo(venueStr, isHome, opponentName) {
    const lowerVenue = (venueStr || '').toLowerCase();

    for (const [key, info] of Object.entries(STADIUM_TRANSPORT_GUIDES)) {
        if (lowerVenue.includes(key)) {
            return info;
        }
    }

    if (isHome) {
        return STADIUM_TRANSPORT_GUIDES['camp Nou'] || STADIUM_TRANSPORT_GUIDES['camp nou'];
    }

    // Default away venue response
    const cleanVenue = venueStr ? `${venueStr} 🇪🇸` : `${opponentName || 'Away'} Stadium`;
    return {
        venueEn: cleanVenue,
        venueEs: cleanVenue,
        transportEn: `Check local public transport and stadium arrival guidelines for ${cleanVenue}. Arrive at least 45–60 minutes prior to kick-off.`,
        transportEs: `Consulta el transporte público local y las indicaciones oficiales de llegada para ${cleanVenue}. Se recomienda llegar con 45–60 minutos de antelación.`
    };
}

/**
 * Fetches all FC Barcelona fixtures from live public and official football endpoints
 */
export async function syncBarcelonaFixturesFromApi() {
    logger.info('[Football API] Starting sync of FC Barcelona fixtures from ESPN API (2026/2027 Season)...');
    const leagues = [
        { code: 'esp.1', name: 'LaLiga' },
        { code: 'uefa.champions', name: 'UEFA Champions League' },
        { code: 'esp.copa_del_rey', name: 'Copa del Rey' },
        { code: 'esp.super_copa', name: 'Supercopa de España' }
    ];

    const scoreboardDateRanges = [
        { league: 'esp.1', range: '20260801-20261031' },
        { league: 'esp.1', range: '20261101-20261231' },
        { league: 'esp.1', range: '20270101-20270331' },
        { league: 'esp.1', range: '20270401-20270630' },
        { league: 'uefa.champions', range: '20260801-20261231' },
        { league: 'uefa.champions', range: '20270101-20270630' },
        { league: 'esp.copa_del_rey', range: '20260801-20270630' },
        { league: 'esp.super_copa', range: '20270101-20270131' }
    ];

    const currentYear = new Date().getUTCFullYear();
    const seasonsToQuery = [currentYear, currentYear + 1];
    const uniqueSeasons = [...new Set(seasonsToQuery)];

    const allEventsMap = new Map();
    let totalFetched = 0;
    let modifiedCount = 0;

    const processEspnEvents = (events, leagueCode, defaultLeagueName) => {
        if (!Array.isArray(events) || events.length === 0) return;

        // Filter to FC Barcelona matches only
        const barcaEvents = events.filter(ev => {
            const comp = ev.competitions?.[0];
            const competitors = comp?.competitors || [];
            return competitors.some(c => c.id === '83' || c.team?.displayName?.toLowerCase().includes('barcelona'));
        });

        barcaEvents.forEach((ev) => {
            const comp = ev.competitions?.[0];
            const competitors = comp?.competitors || [];
            const barca = competitors.find(c => c.id === '83' || c.team?.displayName?.toLowerCase().includes('barcelona'));
            const opponent = competitors.find(c => c.id !== '83' && !c.team?.displayName?.toLowerCase().includes('barcelona'));

            const isHome = barca ? barca.homeAway === 'home' : true;
            const opponentName = opponent?.team?.displayName?.toUpperCase() || 'OPPONENT';
            const venueRaw = comp?.venue?.fullName || (isHome ? 'Spotify Camp Nou' : '');
            const venueCity = comp?.venue?.address?.city || '';
            const venueCombined = venueRaw ? `${venueRaw}${venueCity ? ', ' + venueCity : ''}` : '';

            const stadiumInfo = getStadiumInfo(venueCombined, isHome, opponentName);
            const kickoffDate = new Date(ev.date);
            const formattedDates = formatBilingualDateTimes(kickoffDate);

            const leagueName = defaultLeagueName || (leagueCode === 'esp.1' ? 'LaLiga' : 'Official Competition');
            const roundLabel = comp?.notes?.[0]?.headline || comp?.type?.text || 'Official Match';

            const title = isHome
                ? `FC BARCELONA vs ${opponentName}`
                : `${opponentName} vs FC BARCELONA`;

            const matchObj = {
                id: `api-barca-${ev.id}`,
                espnId: ev.id,
                opponent: opponentName,
                homeOrAway: isHome ? 'home' : 'away',
                title,
                competition: leagueName,
                matchday: roundLabel,
                kickoffUtc: ev.date,
                kickoffEn: formattedDates.en,
                kickoffEs: formattedDates.es,
                locationEn: stadiumInfo.venueEn,
                locationEs: stadiumInfo.venueEs,
                transportEn: stadiumInfo.transportEn,
                transportEs: stadiumInfo.transportEs,
                status: comp?.status?.type?.name || 'STATUS_SCHEDULED',
                statusDetail: comp?.status?.type?.detail || '',
                isCompleted: Boolean(comp?.status?.type?.completed),
                score: comp?.status?.type?.completed ? `${barca?.score?.displayValue || '0'} - ${opponent?.score?.displayValue || '0'}` : null,
                source: 'ESPN_API'
            };

            const existing = apiMatchesCache.find(m => m.id === matchObj.id);
            if (existing) {
                if (existing.kickoffUtc !== matchObj.kickoffUtc || existing.locationEn !== matchObj.locationEn || existing.status !== matchObj.status) {
                    modifiedCount++;
                }
            }

            allEventsMap.set(matchObj.id, matchObj);
            totalFetched++;
        });
    };

    // 1. Fetch from ESPN Scoreboard date range chunks (most reliable for 2026/2027 full season schedule)
    for (const chunk of scoreboardDateRanges) {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${chunk.league}/scoreboard?dates=${chunk.range}`;
        try {
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                processEspnEvents(data.events, chunk.league, data.league?.name);
            }
        } catch (err) {
            logger.warn(`[Football API] Scoreboard fetch error for ${chunk.league} (${chunk.range}): ${err.message}`);
        }
    }

    // 2. Fetch live daily scoreboard for in-progress / live match updates
    for (const league of leagues) {
        const liveUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.code}/scoreboard`;
        try {
            const response = await fetch(liveUrl);
            if (response.ok) {
                const data = await response.json();
                processEspnEvents(data.events, league.code, data.league?.name || league.name);
            }
        } catch {
            // Live scoreboard may be silent on non-matchdays
        }
    }

    // 3. Query individual team schedule endpoints as supplementary source
    for (const league of leagues) {
        for (const season of uniqueSeasons) {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.code}/teams/83/schedule?season=${season}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    processEspnEvents(data.events, league.code, data.league?.name || league.name);
                }
            } catch {
                // Secondary fallback
            }
        }
    }

    if (allEventsMap.size > 0) {
        // Sort all parsed matches ascending by date
        const sorted = Array.from(allEventsMap.values()).sort((a, b) => {
            return new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime();
        });

        apiMatchesCache = sorted;
        lastSyncTimestamp = new Date().toISOString();
        lastSyncStatus = `Successfully synced ${sorted.length} matches from ESPN API (${modifiedCount} updated)`;
        lastSyncError = null;

        // Persist to disk cache
        try {
            const dataDir = path.dirname(CACHE_FILE_PATH);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(sorted, null, 2), 'utf-8');
            logger.info(`[Football API] Persisted ${sorted.length} ESPN fixtures to disk cache.`);
        } catch (saveErr) {
            logger.warn('[Football API] Could not write fixtures to disk cache:', saveErr.message);
        }

        logger.info(`[Football API] ESPN API sync complete! Loaded ${sorted.length} matches for the 2026/2027 season.`);
        return getAllMatches();
    } else {
        lastSyncTimestamp = new Date().toISOString();
        lastSyncStatus = '2026/2027 LaLiga Schedule Active (Baseline schedule active)';
        lastSyncError = null;
        logger.info('[Football API] API sync check completed. 2026/2027 schedule active.');
        return getAllMatches();
    }
}

/**
 * Gets all matches combining API fixtures, baseline defaults, and guild custom fixtures
 */
export function getAllMatches(customMatches = []) {
    const matchMap = new Map();

    // 1. Add bundled baseline matches for the 2026–2027 season
    for (const m of DEFAULT_BARCELONA_MATCHES) {
        matchMap.set(m.id, m);
    }

    // 2. Add ESPN API matches (overwriting / updating baseline match if same opponent + date within 24 hours)
    for (const apiMatch of apiMatchesCache) {
        if (apiMatch.kickoffUtc >= '2026-08-01') {
            const apiDate = new Date(apiMatch.kickoffUtc).getTime();
            let matchedBaselineId = null;

            for (const [id, baseMatch] of matchMap.entries()) {
                const baseDate = new Date(baseMatch.kickoffUtc).getTime();
                const diffHours = Math.abs(apiDate - baseDate) / (1000 * 60 * 60);

                const oppA = (apiMatch.opponent || '').toLowerCase().replace(/[^a-z]/g, '');
                const oppB = (baseMatch.opponent || '').toLowerCase().replace(/[^a-z]/g, '');

                if (diffHours <= 36 && (oppA.includes(oppB) || oppB.includes(oppA))) {
                    matchedBaselineId = id;
                    break;
                }
            }

            if (matchedBaselineId) {
                // Merge baseline (which has detailed transport guides) with live API (which has live scores, status & exact kickoff time)
                const base = matchMap.get(matchedBaselineId);
                matchMap.set(matchedBaselineId, {
                    ...base,
                    ...apiMatch,
                    id: matchedBaselineId,
                    matchday: base.matchday || apiMatch.matchday,
                    locationEn: base.locationEn || apiMatch.locationEn,
                    locationEs: base.locationEs || apiMatch.locationEs,
                    transportEn: base.transportEn || apiMatch.transportEn,
                    transportEs: base.transportEs || apiMatch.transportEs
                });
            } else {
                matchMap.set(apiMatch.id, apiMatch);
            }
        }
    }

    // 3. Always include custom guild-defined matches
    for (const m of customMatches) {
        matchMap.set(m.id, m);
    }

    return Array.from(matchMap.values()).sort((a, b) => {
        const timeA = new Date(a.kickoffUtc).getTime();
        const timeB = new Date(b.kickoffUtc).getTime();
        return timeA - timeB;
    });
}

/**
 * Formats a match announcement with rich matchday details, bilingual kickoff times, dynamic Discord countdowns, venue access, and broadcast info
 */
export function formatMatchAnnouncement(match, roleId = null) {
    let roleMention = '';
    if (roleId) {
        const cleanRoleId = String(roleId).trim();
        if (cleanRoleId === 'everyone' || cleanRoleId === '@everyone') {
            roleMention = '\n\n@everyone';
        } else if (cleanRoleId === 'here' || cleanRoleId === '@here') {
            roleMention = '\n\n@here';
        } else {
            roleMention = `\n\n<@&${cleanRoleId}>`;
        }
    }
    const kickoffUnix = match.kickoffUtc ? Math.floor(new Date(match.kickoffUtc).getTime() / 1000) : null;
    const discordTime = kickoffUnix ? `<t:${kickoffUnix}:F> (<t:${kickoffUnix}:R>)` : 'TBA';
    const isHome = match.homeOrAway === 'home';
    const fixtureType = isHome ? '🏠 Home Match / Partido de Local (Spotify Camp Nou)' : '✈️ Away Match / Partido de Visitante';

    // Derive formatted dates dynamically from kickoffUtc for perfect accuracy
    const formattedTimes = match.kickoffUtc ? formatBilingualDateTimes(match.kickoffUtc) : null;
    const timeEs = formattedTimes?.es || match.kickoffEs || 'Por confirmar';
    const timeEn = formattedTimes?.en || match.kickoffEn || 'To be announced';

    return `# 🔵🔴 FC BARCELONA – MATCHDAY ALERT / AVISO DE PARTIDO
## ⚽ **${match.title}**

🏆 **Competition / Competición:** ${match.competition || 'Official Competition'} • ${match.matchday || 'Official Matchday'}
📍 **Fixture Type / Tipo:** ${fixtureType}

---
### ⏰ **Kick-off Times / Horarios:**
• 🇪🇸 **Spain / Local:** ${timeEs}
• 🇺🇸/🇨🇦 **North America (EDT/EST):** ${timeEn}
• 🌐 **Your Local Device Time:** ${discordTime}

---
### 🏟️ **Venue & Stadium Access / Estadio:**
• 📍 **Location:** ${match.locationEn}
• 🎟️ **Gates & Arrival:** Gates typically open 90 minutes before kick-off. Arrive 45–60 minutes in advance for security checks and ticket scanning.

---
### 🚇 **Public Transport / Transporte Público:**
🇬🇧 **English:**
${match.transportEn || 'Check local public transit connections.'}

🇪🇸 **Español:**
${match.transportEs || 'Consulta el transporte público local para llegar al estadio.'}

---
### 📺 **Broadcast & Streaming / Dónde Ver:**
• 🇪🇸 **Spain:** Movistar+ / DAZN LaLiga
• 🇺🇸 **USA:** ESPN+ / ESPN Deportes
• 🇨🇦 **Canada:** TSN / RDS
• 🇬🇧 **UK:** Premier Sports / LaLigaTV
• 🌎 **Latin America:** ESPN / Disney+${roleMention}`;
}

/**
 * Formats a prediction request for an upcoming match — posted at the same time as the 3-day matchday alert,
 * pings the configured prediction role and asks members to drop their scoreline predictions.
 */
export function formatPredictionAnnouncement(match, roleId = null) {
    let roleMention = '';
    if (roleId) {
        const cleanRoleId = String(roleId).trim();
        if (cleanRoleId === 'everyone' || cleanRoleId === '@everyone') {
            roleMention = '@everyone ';
        } else if (cleanRoleId === 'here' || cleanRoleId === '@here') {
            roleMention = '@here ';
        } else {
            roleMention = `<@&${cleanRoleId}> `;
        }
    }

    const kickoffUnix = match.kickoffUtc ? Math.floor(new Date(match.kickoffUtc).getTime() / 1000) : null;
    const discordTime = kickoffUnix ? `<t:${kickoffUnix}:F> (<t:${kickoffUnix}:R>)` : 'TBA';
    const isHome = match.homeOrAway === 'home';
    const scoreExample = isHome ? `Barça 2–1 ${match.opponent || 'Rival'}` : `${match.opponent || 'Rival'} 0–3 Barça`;

    return `${roleMention}
# 🔮 PREDICCIONES / PREDICTIONS — ${match.title}

🏆 **${match.competition || 'Official Competition'}** • ${match.matchday || 'Official Matchday'}
⏰ **Kick-off:** ${discordTime}

---
🗳️ **Deja tu pronóstico del marcador en este canal / Drop your scoreline prediction in this channel.**
Ejemplo / Example: \`${scoreExample}\`

Bonus: ¿goleador? ¿resultado exacto? / top scorer? exact result?
Los pronósticos cierran al pitido inicial. / Predictions close at kick-off. 🔵🔴`;
}

/**
 * Posts a prediction request message to a channel, pinging the given role.
 */
export async function sendPredictionRequest(client, channelIdOrChannel, match, roleId = null) {
    if (!match) {
        throw new Error('No match fixture data provided to sendPredictionRequest.');
    }

    let targetChannelId = null;
    if (typeof channelIdOrChannel === 'string') {
        targetChannelId = channelIdOrChannel;
    } else if (channelIdOrChannel && typeof channelIdOrChannel === 'object' && channelIdOrChannel.id) {
        targetChannelId = channelIdOrChannel.id;
    }
    if (!targetChannelId) {
        throw new Error('No valid channel or channel ID provided for prediction request.');
    }

    let channel = client.channels?.cache?.get(targetChannelId) ||
        await client.channels?.fetch?.(targetChannelId).catch(err => {
            logger.warn(`Could not fetch channel ${targetChannelId} for prediction request: ${err.message}`);
            return null;
        });

    if (!channel && channelIdOrChannel && typeof channelIdOrChannel.send === 'function') {
        channel = channelIdOrChannel;
    }

    if (!channel || typeof channel.send !== 'function') {
        throw new Error(`Target prediction channel <#${targetChannelId}> is not accessible or cannot receive text messages. Run \`/football set-prediction-channel\` to choose another channel.`);
    }

    let allowedMentions = { parse: [] };
    if (roleId) {
        const cleanRoleId = String(roleId).trim();
        if (cleanRoleId === 'everyone' || cleanRoleId === '@everyone' || (channel.guild && cleanRoleId === channel.guild.id)) {
            allowedMentions = { parse: ['everyone'] };
        } else if (cleanRoleId === 'here' || cleanRoleId === '@here') {
            allowedMentions = { parse: ['everyone'] };
        } else {
            allowedMentions = { roles: [cleanRoleId] };
        }
    }

    try {
        return await channel.send({
            content: formatPredictionAnnouncement(match, roleId),
            allowedMentions
        });
    } catch (sendError) {
        logger.error(`Failed to send prediction request in #${channel.name || targetChannelId}:`, sendError);
        if (sendError.code === 50013 || sendError.message?.toLowerCase().includes('permission')) {
            throw new Error(`Missing required Discord permissions to send messages in <#${targetChannelId}>.`);
        }
        throw new Error(`Failed to send prediction request to <#${targetChannelId}>: ${sendError.message}`);
    }
}

/**
 * Gets the football configuration for a guild
 */
export async function getFootballConfig(client, guildId) {
    try {
        const guildConfig = await getGuildConfig(client, guildId);
        return {
            enabled: guildConfig.football?.enabled ?? false,
            channelId: guildConfig.football?.channelId ?? null,
            roleId: guildConfig.football?.roleId ?? null,
            postedMatches: guildConfig.football?.postedMatches ?? [],
            predictionsEnabled: guildConfig.football?.predictionsEnabled ?? false,
            predictionChannelId: guildConfig.football?.predictionChannelId ?? null,
            predictionRoleId: guildConfig.football?.predictionRoleId ?? null,
            predictedMatches: guildConfig.football?.predictedMatches ?? [],
            // The single match currently open for score predictions in predictionChannelId — set
            // when a prediction request goes out, cleared once /football set-result resolves it.
            // predictionService.js reads this to know which match a "2-1" message in that channel
            // is a prediction FOR (there's only ever one open at a time).
            activePredictionMatchId: guildConfig.football?.activePredictionMatchId ?? null,
            customMatches: guildConfig.football?.customMatches ?? [],
            scheduleChannelId: guildConfig.football?.scheduleChannelId ?? null,
            scheduleMessageId: guildConfig.football?.scheduleMessageId ?? null,
            scheduleEnabled: guildConfig.football?.scheduleEnabled ?? true
        };
    } catch (error) {
        logger.error(`Error retrieving football config for guild ${guildId}:`, error);
        return {
            enabled: false,
            channelId: null,
            roleId: null,
            postedMatches: [],
            predictionsEnabled: false,
            predictionChannelId: null,
            predictionRoleId: null,
            predictedMatches: [],
            activePredictionMatchId: null,
            customMatches: [],
            scheduleChannelId: null,
            scheduleMessageId: null,
            scheduleEnabled: true
        };
    }
}

/**
 * Updates football configuration for a guild
 */
export async function setFootballConfig(client, guildId, patch) {
    try {
        const guildConfig = await getGuildConfig(client, guildId);
        const existingFootball = guildConfig.football || {};

        const updatedFootball = {
            ...existingFootball,
            ...patch
        };

        const updatedConfig = {
            ...guildConfig,
            football: updatedFootball
        };

        await setGuildConfig(client, guildId, updatedConfig);
        return updatedFootball;
    } catch (error) {
        logger.error(`Error saving football config for guild ${guildId}:`, error);
        throw error;
    }
}

/**
 * Updates or posts the live hourly schedule board message in a guild channel
 */
export async function updateLiveScheduleBoard(client, guildId, customChannel = null, forceNewMessage = false) {
    try {
        const config = await getFootballConfig(client, guildId);

        let channelId = customChannel ? customChannel.id : config.scheduleChannelId;
        if (!channelId) return null;

        let channel = customChannel;
        if (!channel) {
            channel = client.channels?.cache?.get(channelId) || await client.channels?.fetch?.(channelId).catch(() => null);
        }

        if (!channel || typeof channel.send !== 'function') {
            logger.warn(`[Football Live Board] Target schedule channel ${channelId} not found or inaccessible in guild ${guildId}`);
            return null;
        }

        const matches = getAllMatches(config.customMatches);
        const now = Date.now();
        const upcoming = matches.filter(m => new Date(m.kickoffUtc).getTime() >= now);
        const past = matches.filter(m => new Date(m.kickoffUtc).getTime() < now);

        const apiStatus = getFootballApiStatus();
        const nextMatch = upcoming[0];
        const followingMatches = upcoming.slice(1, 10);
        const recentMatches = [...past].reverse().slice(0, 3);

        const nextMatchUnix = nextMatch ? Math.floor(new Date(nextMatch.kickoffUtc).getTime() / 1000) : null;

        const embed = new EmbedBuilder()
            .setColor(0xA50044) // FC Barcelona Blaugrana
            .setTitle('⚽ FC BARCELONA – 2026/2027 LIVE MATCH SCHEDULE')
            .setDescription(
                `*This schedule board auto-updates **every 1 hour** with latest kickoff times, venues, and score updates to avoid rate limits.*\n\n` +
                (nextMatch 
                    ? `🔴 **NEXT MATCH / PRÓXIMO PARTIDO:**\n**${nextMatch.title}**\n🏆 ${nextMatch.competition} (${nextMatch.matchday})\n📅 ${nextMatch.kickoffEn} (<t:${nextMatchUnix}:R>)\n📍 ${nextMatch.locationEn}` 
                    : `🔴 **NEXT MATCH:** TBD`)
            );

        if (followingMatches.length > 0) {
            let upcomingText = '';
            for (const m of followingMatches) {
                const timeUnix = Math.floor(new Date(m.kickoffUtc).getTime() / 1000);
                const line = `• **${m.title}**\n  🏆 ${m.competition} (${m.matchday}) | <t:${timeUnix}:f> (<t:${timeUnix}:R>)\n  📍 *${m.locationEn}*\n\n`;
                if ((upcomingText + line).length > 1020) break;
                upcomingText += line;
            }
            embed.addFields({ name: '⏳ Following Fixtures / Siguientes Partidos', value: upcomingText.trim() });
        }

        if (recentMatches.length > 0) {
            let pastText = '';
            for (const m of recentMatches) {
                pastText += `• **${m.title}** (${m.matchday})\n  📅 ${m.kickoffEn} | 📍 ${m.locationEn}\n\n`;
            }
            embed.addFields({ name: '🏁 Recently Completed / Resultados Recientes', value: pastText.trim() });
        }

        const nowUtcStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        embed.setFooter({
            text: `🔄 Auto-Updates Hourly • FC Barcelona Live Board • Last Updated: ${nowUtcStr} UTC`
        }).setTimestamp();

        let message = null;
        if (config.scheduleMessageId && !forceNewMessage) {
            try {
                message = await channel.messages.fetch(config.scheduleMessageId);
            } catch (e) {
                message = null;
            }
        }

        if (message) {
            await message.edit({ embeds: [embed] });
            await setFootballConfig(client, guildId, {
                scheduleChannelId: channel.id,
                scheduleMessageId: message.id,
                scheduleEnabled: true
            });
            logger.info(`[Football Live Board] Edited existing live board message (${message.id}) in guild "${channel.guild?.name || guildId}" (#${channel.name || channel.id})`);
        } else {
            message = await channel.send({ embeds: [embed] });
            await setFootballConfig(client, guildId, {
                scheduleChannelId: channel.id,
                scheduleMessageId: message.id,
                scheduleEnabled: true
            });
            logger.info(`[Football Live Board] Posted new live board message (${message.id}) in guild "${channel.guild?.name || guildId}" (#${channel.name || channel.id})`);
        }

        return message;
    } catch (err) {
        logger.error(`[Football Live Board] Error updating live schedule board for guild ${guildId}:`, err);
        throw err;
    }
}

/**
 * Posts a match alert directly to a channel
 */
export async function sendMatchAlert(client, channelIdOrChannel, match, roleId = null) {
    if (!match) {
        throw new Error('No match fixture data provided to sendMatchAlert.');
    }

    let channel = null;
    let targetChannelId = null;

    if (typeof channelIdOrChannel === 'string') {
        targetChannelId = channelIdOrChannel;
    } else if (channelIdOrChannel && typeof channelIdOrChannel === 'object' && channelIdOrChannel.id) {
        targetChannelId = channelIdOrChannel.id;
    }

    if (!targetChannelId) {
        throw new Error('No valid channel or channel ID provided for match announcement.');
    }

    // Always fetch or get from cache to ensure full text-channel instance with .send()
    channel = client.channels?.cache?.get(targetChannelId) ||
              await client.channels?.fetch?.(targetChannelId).catch(err => {
                  logger.warn(`Could not fetch channel ${targetChannelId} for match announcement: ${err.message}`);
                  return null;
              });

    // Fallback if direct object had .send
    if (!channel && channelIdOrChannel && typeof channelIdOrChannel.send === 'function') {
        channel = channelIdOrChannel;
    }

    if (!channel || typeof channel.send !== 'function') {
        throw new Error(`Target channel <#${targetChannelId}> is not accessible or cannot receive text messages. Please check that the bot has access to this channel or run \`/football set-channel\` to choose another channel.`);
    }

    const messageContent = formatMatchAnnouncement(match, roleId);

    // Build allowedMentions so role pings always dispatch cleanly without Discord API parse/roles conflicts
    let allowedMentions = { parse: [] };
    if (roleId) {
        const cleanRoleId = String(roleId).trim();
        if (cleanRoleId === 'everyone' || cleanRoleId === '@everyone' || (channel.guild && cleanRoleId === channel.guild.id)) {
            allowedMentions = { parse: ['everyone'] };
        } else if (cleanRoleId === 'here' || cleanRoleId === '@here') {
            allowedMentions = { parse: ['everyone'] };
        } else {
            // Note: Discord API strictly requires either parse: ['roles'] OR roles: [ids], NEVER both!
            allowedMentions = { roles: [cleanRoleId] };
        }
    }

    try {
        const sentMessage = await channel.send({
            content: messageContent,
            allowedMentions
        });

        return sentMessage;
    } catch (sendError) {
        logger.error(`Failed to send match alert message in #${channel.name || targetChannelId}:`, sendError);
        if (sendError.code === 50013 || sendError.message?.toLowerCase().includes('permission')) {
            throw new Error(`Missing required Discord permissions to send messages in <#${targetChannelId}>. Ensure the bot has "View Channel" and "Send Messages" permissions in that channel.`);
        }
        throw new Error(`Failed to send message to <#${targetChannelId}>: ${sendError.message}`);
    }
}

/**
 * Checks for upcoming matches within 3 days (72 hours) and updates live schedule boards
 */
export async function checkFootballAnnouncements(client) {
    if (!client || !client.isReady || !client.isReady()) {
        logger.debug('[Football Scheduler] Skipping scheduled check: Discord client not ready');
        return;
    }

    const guilds = client.guilds?.cache ? Array.from(client.guilds.cache.values()) : [];
    logger.info(`[Football Scheduler] Running hourly FC Barcelona fixture sync & schedule check across ${guilds.length} server(s)...`);

    // 1. Sync live fixtures from API every hour to catch schedule/time/score changes
    try {
        await syncBarcelonaFixturesFromApi();
    } catch (syncErr) {
        logger.warn('[Football Scheduler] Hourly API sync warning: ' + syncErr.message);
    }

    const now = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000; // 72 hours (3 days)
    const triggerThreshold = now + THREE_DAYS_MS;
    const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
    let boardsUpdated = 0;
    let alertsSent = 0;

    for (const guild of guilds) {
        const guildId = guild.id;
        try {
            const config = await getFootballConfig(client, guildId);

            // 2. Auto-update live schedule board message if enabled for this guild
            if (config.scheduleEnabled && config.scheduleChannelId) {
                logger.info(`[Football Live Board] Auto-updating live board for guild "${guild.name}" (${guildId}) in channel #${config.scheduleChannelId}...`);
                await updateLiveScheduleBoard(client, guildId)
                    .then(msg => {
                        if (msg) boardsUpdated++;
                    })
                    .catch(err => {
                        logger.error(`[Football Scheduler] Failed to update live board in guild "${guild.name}" (${guildId}):`, err.message);
                    });
            }

            // 3. Process 3-day automated match announcements
            const alertsActive = config.enabled && config.channelId;
            if (!alertsActive && !(config.predictionsEnabled && config.predictionChannelId)) {
                continue;
            }

            const allMatches = getAllMatches(config.customMatches);
            const matchMap = new Map(allMatches.map(m => [m.id, m]));
            const postedSet = new Set(config.postedMatches || []);
            const predictedSet = new Set(config.predictedMatches || []);
            const predictionsActive = config.predictionsEnabled && config.predictionChannelId;
            let configNeedsSave = false;
            let activePredictionMatchId = null;

            // Prune stale postedMatch IDs older than 45 days
            for (const postedId of postedSet) {
                const match = matchMap.get(postedId);
                if (match && match.kickoffUtc) {
                    const matchTime = new Date(match.kickoffUtc).getTime();
                    if (now - matchTime > FORTY_FIVE_DAYS_MS) {
                        postedSet.delete(postedId);
                        configNeedsSave = true;
                    }
                }
            }
            for (const predId of predictedSet) {
                const match = matchMap.get(predId);
                if (match && match.kickoffUtc) {
                    const matchTime = new Date(match.kickoffUtc).getTime();
                    if (now - matchTime > FORTY_FIVE_DAYS_MS) {
                        predictedSet.delete(predId);
                        configNeedsSave = true;
                    }
                }
            }

            for (const match of allMatches) {
                const matchTime = new Date(match.kickoffUtc).getTime();

                // Check if match is in the future AND within 3 days from now
                const isWithin3Days = matchTime > now && matchTime <= triggerThreshold;

                if (isWithin3Days && alertsActive && !postedSet.has(match.id)) {
                    logger.info(`[Football] Match ${match.title} is within 3 days! Posting announcement to guild ${guild.name} (#${config.channelId})...`);

                    try {
                        await sendMatchAlert(client, config.channelId, match, config.roleId);
                        postedSet.add(match.id);
                        alertsSent++;
                        configNeedsSave = true;
                        logger.info(`[Football] Successfully posted 3-day match announcement for ${match.title} in ${guild.name}`);
                    } catch (sendErr) {
                        logger.error(`[Football] Failed to post match announcement for ${match.title} in guild ${guildId}:`, sendErr);
                    }
                }

                // Prediction request — fires on the same 3-day trigger as the matchday alert
                if (isWithin3Days && predictionsActive && !predictedSet.has(match.id)) {
                    logger.info(`[Football] Match ${match.title} within 3 days! Posting prediction request to guild ${guild.name} (#${config.predictionChannelId})...`);

                    try {
                        await sendPredictionRequest(client, config.predictionChannelId, match, config.predictionRoleId);
                        predictedSet.add(match.id);
                        activePredictionMatchId = match.id;
                        configNeedsSave = true;
                        logger.info(`[Football] Successfully posted prediction request for ${match.title} in ${guild.name}`);
                    } catch (predErr) {
                        logger.error(`[Football] Failed to post prediction request for ${match.title} in guild ${guildId}:`, predErr);
                    }
                }
            }

            if (configNeedsSave) {
                const patch = {
                    postedMatches: Array.from(postedSet),
                    predictedMatches: Array.from(predictedSet)
                };
                if (activePredictionMatchId) patch.activePredictionMatchId = activePredictionMatchId;
                await setFootballConfig(client, guildId, patch);
            }
        } catch (guildErr) {
            logger.error(`[Football] Error processing announcements for guild ${guildId}:`, guildErr);
        }
    }

    logger.info(`[Football Scheduler] Cycle complete: checked ${guilds.length} guild(s), refreshed ${boardsUpdated} live schedule board(s), sent ${alertsSent} match alert(s).`);
}

/**
 * Returns summary of API sync and cached match stats
 */
export function getFootballApiStatus() {
    return {
        cachedMatchesCount: apiMatchesCache.length,
        totalAvailableMatches: getAllMatches().length,
        lastSyncTimestamp,
        lastSyncStatus,
        lastSyncError
    };
}
