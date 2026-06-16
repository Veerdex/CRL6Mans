// Only ever dynamically imported inside click handlers — never SSR'd
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { TournamentPdfData } from "./tournament-pdf-actions";

const ORANGE = "#e88a24";
const BLUE = "#3736ac";
const DARK = "#18181b";
const LIGHT = "#a1a1aa";
const WHITE = "#ffffff";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const s = StyleSheet.create({
  page: { backgroundColor: WHITE, fontFamily: "Helvetica", fontSize: 10, color: DARK, paddingBottom: 50 },
  header: { backgroundColor: BLUE, padding: "24 32 20 32" },
  headerTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: WHITE, marginBottom: 4 },
  headerMeta: { fontSize: 9, color: "#c7d2fe", flexDirection: "row" },
  metaItem: { flexDirection: "row", marginRight: 16 },
  metaLabel: { color: "#818cf8", marginRight: 4 },
  metaValue: { color: WHITE },
  champion: {
    backgroundColor: ORANGE, margin: "16 32 0 32", borderRadius: 6,
    padding: "12 16", flexDirection: "row", alignItems: "center",
  },
  championLogo: { width: 44, height: 44, marginRight: 12, borderRadius: 4 },
  championTitle: { fontSize: 9, color: "#fff7ed", fontFamily: "Helvetica-Bold", marginBottom: 2 },
  championName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: WHITE },
  championPlayers: { fontSize: 8, color: "#fed7aa", marginTop: 4 },
  runnerUpWrap: { marginLeft: "auto", alignItems: "flex-end", flexDirection: "row" },
  runnerUpLogo: { width: 28, height: 28, marginLeft: 8, borderRadius: 3 },
  runnerUpText: { alignItems: "flex-end" },
  runnerUpLabel: { fontSize: 8, color: "#fed7aa", marginBottom: 1 },
  runnerUpName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: WHITE },
  runnerUpPlayers: { fontSize: 7, color: "#fed7aa", marginTop: 3, textAlign: "right" },
  section: { margin: "20 32 0 32" },
  sectionTitle: {
    fontSize: 11, fontFamily: "Helvetica-Bold", color: BLUE,
    marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1.5, borderBottomColor: ORANGE,
  },
  tableHead: { flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, backgroundColor: DARK },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 8 },
  tableRowAlt: { flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, backgroundColor: "#f4f4f5" },
  headText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#a1a1aa" },
  colPlace: { width: 24, textAlign: "center" },
  colLogo: { width: 22 },
  colName: { flex: 1 },
  colStat: { width: 32, textAlign: "center" },
  logoThumb: { width: 18, height: 18, borderRadius: 2 },
  teamNameRow: { flexDirection: "row", alignItems: "center" },
  roundLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: LIGHT, marginTop: 10, marginBottom: 4 },
  matchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8 },
  matchRowAlt: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#f4f4f5" },
  matchHome: { flex: 1, fontFamily: "Helvetica-Bold" },
  matchAway: { flex: 1, textAlign: "right", fontFamily: "Helvetica-Bold" },
  matchScore: { width: 48, textAlign: "center", fontSize: 11, fontFamily: "Helvetica-Bold", color: BLUE },
  pageNumber: { position: "absolute", fontSize: 8, bottom: 24, left: 0, right: 0, textAlign: "center", color: LIGHT },
});

export function TournamentReportDocument({ data }: { data: TournamentPdfData }) {
  const rounds = data.matches.reduce<string[]>((acc, m) => {
    const key = m.stage + " " + m.round;
    if (!acc.includes(key)) acc.push(key);
    return acc;
  }, []);

  const hasLogos = data.standings.some((r) => r.logoUrl);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>{data.name}</Text>
          <View style={s.headerMeta}>
            {data.format ? (
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Format </Text>
                <Text style={s.metaValue}>{data.format}</Text>
              </View>
            ) : null}
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>Teams </Text>
              <Text style={s.metaValue}>{data.teamCount}</Text>
            </View>
            {data.startedAt ? (
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Started </Text>
                <Text style={s.metaValue}>{fmtDate(data.startedAt)}</Text>
              </View>
            ) : null}
            {data.endedAt ? (
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Ended </Text>
                <Text style={s.metaValue}>{fmtDate(data.endedAt)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Champion banner */}
        {data.champion ? (
          <View style={s.champion}>
            {data.championLogoUrl ? (
              <Image src={data.championLogoUrl} style={s.championLogo} />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={s.championTitle}>CHAMPION</Text>
              <Text style={s.championName}>{data.champion}</Text>
              {data.championPlayers.length > 0 ? (
                <Text style={s.championPlayers}>
                  {data.championPlayers.map((p) => p.displayName ?? p.username).join("  ·  ")}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Standings */}
        {data.standings.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Final Standings</Text>
            <View style={s.tableHead}>
              <Text style={[s.headText, s.colPlace]}>#</Text>
              {hasLogos ? <View style={s.colLogo} /> : null}
              <Text style={[s.headText, s.colName]}>Team</Text>
              <Text style={[s.headText, s.colStat]}>W</Text>
              <Text style={[s.headText, s.colStat]}>L</Text>
            </View>
            {data.standings.map((row, i) => (
              <View key={row.place} style={i % 2 === 1 ? s.tableRowAlt : s.tableRow}>
                <Text style={[s.colPlace, { color: row.place <= 3 ? ORANGE : LIGHT }]}>
                  {row.place}
                </Text>
                {hasLogos ? (
                  <View style={s.colLogo}>
                    {row.logoUrl ? (
                      <Image src={row.logoUrl} style={s.logoThumb} />
                    ) : null}
                  </View>
                ) : null}
                <Text style={[s.colName, row.place === 1 ? { fontFamily: "Helvetica-Bold" } : {}]}>
                  {row.name}
                </Text>
                <Text style={[s.colStat, { color: "#16a34a", fontFamily: "Helvetica-Bold" }]}>
                  {row.wins}
                </Text>
                <Text style={[s.colStat, { color: "#dc2626" }]}>{row.losses}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Match Results */}
        {data.matches.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Match Results</Text>
            {rounds.map((roundKey) => {
              const roundMatches = data.matches.filter(
                (m) => m.stage + " " + m.round === roundKey
              );
              return (
                <View key={roundKey}>
                  <Text style={s.roundLabel}>{roundKey.toUpperCase()}</Text>
                  {roundMatches.map((m, i) => {
                    const homeWon = m.homeScore > m.awayScore;
                    const awayWon = m.awayScore > m.homeScore;
                    return (
                      <View key={i} style={i % 2 === 1 ? s.matchRowAlt : s.matchRow}>
                        <Text style={[s.matchHome, { color: homeWon ? BLUE : LIGHT }]}>
                          {m.home}
                        </Text>
                        <Text style={s.matchScore}>{m.homeScore} - {m.awayScore}</Text>
                        <Text style={[s.matchAway, { color: awayWon ? BLUE : LIGHT }]}>
                          {m.away}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        ) : null}

        <Text
          style={s.pageNumber}
          render={({ pageNumber, totalPages }) => pageNumber + " / " + totalPages}
          fixed
        />

      </Page>
    </Document>
  );
}
