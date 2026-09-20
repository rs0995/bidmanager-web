import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ArrowUpRight, Bell, ChevronRight, CloudDownload } from 'lucide-react-native';
import { tenders, money } from './data';

type Tender = typeof tenders[number];
type Colors = { bg: string; white: string; text: string; muted: string; teal: string; tint: string; strong: string; soft: string; accent: string; accentEnd: string; line: string };
type Props = { colors: Colors; saved: string[]; projects: { tenderId: string; value: number; stage: string }[]; unread: number; onTender: (t: Tender) => void; onTenders: () => void; onProjects: () => void; onBookmarks: () => void; onAlerts: () => void };
const font = 'IBMPlexSans_400Regular';
const bold = 'IBMPlexSans_600SemiBold';

function Gradient({ colors }: { colors: Colors }) {
  return <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none"><Defs><LinearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.accent}/><Stop offset="1" stopColor={colors.accentEnd}/></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#accent)"/></Svg>;
}
function Ring({ value, title, label, colors, size = 92 }: { value: number; title: string; label: string; colors: Colors; size?: number }) {
  const radius = 42, circumference = 2 * Math.PI * radius;
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${label}: ${title}`}>
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}><Defs><LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.accent}/><Stop offset="1" stopColor={colors.accentEnd}/></LinearGradient></Defs><Circle cx="50" cy="50" r={radius} stroke={colors.line} strokeWidth="9" fill="none"/><Circle cx="50" cy="50" r={radius} stroke="url(#ring)" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={`${circumference * Math.max(0, Math.min(1, value))} ${circumference}`} rotation="-90" origin="50,50"/></Svg>
    <Text style={{ fontFamily: bold, color: colors.text, fontSize: 19 }}>{title}</Text><Text style={{ fontFamily: font, color: colors.muted, fontSize: 9, marginTop: 2 }}>{label}</Text>
  </View>;
}

export default function Dashboard({ colors: C, saved, projects, unread, onTender, onTenders, onProjects, onBookmarks, onAlerts }: Props) {
  const [portal, setPortal] = useState('All portals');
  const [day, setDay] = useState<number | null>(null);
  const items = tenders.filter(t => portal === 'All portals' || t.source === portal);
  const bids = projects.filter(p => p.stage !== 'Archived' && items.some(t => t.id === p.tenderId));
  const value = bids.reduce((sum, p) => sum + p.value, 0);
  const target = 21.4;
  const percentage = Math.min(100, Math.round(value / target * 100));
  const bookmarked = items.filter(t => saved.includes(t.id));
  const closing = items.filter(t => t.days <= 7 && (day === null || t.days === day - 19));
  const next = items[0];
  const card = [styles.card, { backgroundColor: C.white, shadowColor: C.strong }];
  const text = { color: C.text };
  const muted = { color: C.muted };
  return <View>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open projects" onPress={onProjects} style={styles.avatar}><Gradient colors={C}/><Text style={styles.avatarText}>RI</Text></Pressable>
      <View style={{ flex: 1 }}><Text style={[styles.heading, text]}>Dashboard</Text><Text style={[styles.subheading, muted]}>Rakshit Infra · sample workspace</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open notifications" onPress={onAlerts} style={[styles.notification, { backgroundColor: C.white }]}><Bell size={21} color={C.accent}/>{unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}</Pressable>
    </View>

    <View style={styles.week}>{['SA', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR'].map((name, i) => {
      const date = 19 + i, hasDeadline = items.some(t => t.days === i), selected = (day ?? 19) === date;
      return <Pressable key={date} accessibilityRole="button" accessibilityLabel={`September ${date}${selected ? ', selected' : ''}`} accessibilityState={{ selected }} onPress={() => setDay(day === date ? null : date)} style={[styles.day, selected && { backgroundColor: C.white, shadowColor: C.strong, shadowOpacity: .06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 }]}><Text style={[styles.dayName, muted]}>{name}</Text><Text style={[styles.dayNumber, { color: selected ? C.teal : C.text }]}>{date}</Text><View style={[styles.dayDot, { backgroundColor: hasDeadline ? C.accent : C.line }]}/></Pressable>;
    })}</View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portals}>{['All portals', 'GeM', 'CPPP'].map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: portal === name }} onPress={() => setPortal(name)} style={[styles.portal, { backgroundColor: C.white }]}>{portal === name && <Gradient colors={C}/>}<Text style={[styles.portalLabel, { color: portal === name ? '#FFFFFF' : C.text }]}>{name}</Text></Pressable>)}</ScrollView>

    <View style={[card, styles.hero]}>
      <Text style={[styles.cardTitle, text]}>Pipeline Snapshot</Text><Text style={[styles.subtitle, muted]}>{items.length} active tenders to explore</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="View pipeline projects" onPress={onProjects} style={styles.pipelineRow}><View style={{ flex: 1 }}><Text style={[styles.amount, text]}>₹{value.toFixed(2)}<Text style={[styles.unit, muted]}>Cr</Text></Text><Text style={[styles.targetNote, muted]}>{percentage}% of quarterly target</Text></View><Ring colors={C} value={percentage / 100} title={`${percentage}%`} label="TARGET"/></Pressable>
      <View style={styles.meters}>{[
        { label: 'Active', count: items.length, ratio: items.length / tenders.length, press: onTenders },
        { label: 'Bookmarked', count: bookmarked.length, ratio: bookmarked.length / Math.max(items.length, 1), press: onBookmarks },
        { label: 'Closing soon', count: items.filter(t => t.days <= 7).length, ratio: items.filter(t => t.days <= 7).length / Math.max(items.length, 1), press: onTenders },
      ].map(m => <Pressable key={m.label} accessibilityRole="button" onPress={m.press} style={styles.meter}><View style={styles.meterLabel}><Text style={[styles.meterName, text]}>{m.label}</Text><Text style={[styles.meterCount, muted]}>{m.count}</Text></View><View style={[styles.track, { backgroundColor: C.line }]}><View style={{ width: `${m.ratio * 100}%`, height: '100%', overflow: 'hidden', borderRadius: 5 }}><Gradient colors={C}/></View></View></Pressable>)}</View>
    </View>

    <View style={styles.twins}>
      <Pressable accessibilityRole="button" accessibilityLabel="View next deadline" onPress={() => onTender(next)} style={[card, styles.twin]}><Text style={[styles.cardTitle, text]}>Next Deadline</Text><View style={styles.deadlineRing}><Ring colors={C} size={108} value={.22} title={`${next.days}d 4h`} label="REMAINING"/></View><Text numberOfLines={1} style={[styles.twinTitle, text]}>{next.org}</Text><Text style={[styles.small, muted]}>{next.date}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="View sample sync information" onPress={onTenders} style={[card, styles.twin]}><Text style={[styles.cardTitle, text]}>Sync</Text><View style={[styles.cloud, { backgroundColor: C.tint }]}><CloudDownload size={25} color={C.accent}/></View><Text style={[styles.syncNumber, text]}>{items.length}</Text><Text style={[styles.subtitle, muted]}>tenders in this preview</Text><View style={styles.syncFooter}><Text style={[styles.small, { color: C.teal }]}>Explore tenders</Text><ArrowUpRight size={14} color={C.teal}/></View></Pressable>
    </View>

    <View style={[card, styles.list]}><View style={styles.listHeading}><Text style={[styles.cardTitle, text]}>{day === null ? 'Closing soon' : `Closing on ${day} Sep`}</Text><Pressable accessibilityRole="button" onPress={day !== null ? () => setDay(null) : onTenders}><Text style={[styles.small, { color: C.teal }]}>{day !== null ? 'Clear date' : 'View all'}</Text></Pressable></View>{closing.length ? closing.slice(0, 3).map(t => <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Open ${t.title}`} onPress={() => onTender(t)} style={[styles.listRow, { borderTopColor: C.line }]}><View style={[styles.dateBadge, { backgroundColor: C.bg }]}><Text style={[styles.dateNumber, text]}>{t.date.slice(0, 2)}</Text><Text style={[styles.small, muted]}>Sep</Text></View><View style={{ flex: 1 }}><Text numberOfLines={2} style={[styles.listTitle, text]}>{t.title}</Text><Text style={[styles.small, muted]}>{money(t.value)} · {t.source}</Text></View><ChevronRight size={15} color={C.muted}/></Pressable>) : <Text style={[styles.emptyText, muted]}>No submissions close on this date. Choose another day or clear the date.</Text>}</View>
    <Text style={[styles.footnote, muted]}>Demo data · Quarterly target ₹21.40 Cr</Text>
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, marginBottom: 25 }, avatar: { height: 49, width: 49, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: bold, color: '#FFFFFF', fontSize: 16 }, heading: { fontFamily: bold, fontSize: 25, letterSpacing: -.8 }, subheading: { fontFamily: font, fontSize: 11.5, marginTop: 3 }, notification: { height: 45, width: 45, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: 6, top: 5, backgroundColor: '#E44867', width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#FFFFFF', fontFamily: bold, fontSize: 10 },
  week: { flexDirection: 'row', gap: 4, marginBottom: 19 }, day: { flex: 1, minHeight: 82, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 5 }, dayName: { fontFamily: font, fontSize: 10 }, dayNumber: { fontFamily: bold, fontSize: 17 }, dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 }, portals: { gap: 9, paddingBottom: 22 }, portal: { paddingHorizontal: 19, height: 42, borderRadius: 23, overflow: 'hidden', justifyContent: 'center' }, portalLabel: { fontFamily: bold, fontSize: 13 },
  card: { borderRadius: 29, shadowOpacity: .045, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 2 }, hero: { padding: 21, marginBottom: 15 }, cardTitle: { fontFamily: bold, fontSize: 15, letterSpacing: -.3 }, subtitle: { fontFamily: font, fontSize: 12, lineHeight: 18, marginTop: 4 }, pipelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 22 }, amount: { fontFamily: bold, fontSize: 37, letterSpacing: -1.8, fontVariant: ['tabular-nums'] }, unit: { fontFamily: font, fontSize: 15, letterSpacing: -.4 }, targetNote: { fontFamily: font, fontSize: 11, marginTop: 5 }, meters: { flexDirection: 'row', gap: 11 }, meter: { flex: 1, minHeight: 35 }, meterLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 2 }, meterName: { fontFamily: font, fontSize: 10 }, meterCount: { fontFamily: bold, fontSize: 10 }, track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  twins: { flexDirection: 'row', gap: 14, marginBottom: 15 }, twin: { flex: 1, padding: 18, minHeight: 226 }, deadlineRing: { alignItems: 'center', marginTop: 15, marginBottom: 13 }, twinTitle: { fontFamily: bold, fontSize: 11, marginBottom: 4 }, small: { fontFamily: font, fontSize: 11, lineHeight: 17 }, cloud: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 17, marginBottom: 10 }, syncNumber: { fontFamily: bold, fontSize: 32, lineHeight: 38 }, syncFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 }, list: { padding: 20 }, listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 7 }, listRow: { flexDirection: 'row', gap: 10, paddingVertical: 16, borderTopWidth: 1, alignItems: 'center' }, dateBadge: { width: 39, paddingVertical: 7, borderRadius: 11, alignItems: 'center' }, dateNumber: { fontFamily: bold, fontSize: 17 }, listTitle: { fontFamily: bold, fontSize: 12, lineHeight: 18, marginBottom: 4 }, emptyText: { fontFamily: font, fontSize: 12, lineHeight: 20, paddingVertical: 20 }, footnote: { fontFamily: font, fontSize: 10, textAlign: 'center', paddingVertical: 22 },
});
