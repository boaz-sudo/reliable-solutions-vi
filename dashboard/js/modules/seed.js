/* Client Desk — demo seed data.
 * RS.seed() fills an empty store with example clients and reviews for a
 * USVI security-camera / network installer. Every date is computed relative
 * to today so the demo always looks current. All names, phone numbers
 * ((340) 555-01xx is reserved for fiction) and emails are fictional.
 */
(function () {
  'use strict';

  const RS = window.RS = window.RS || {};

  /* ---------- date helpers (offsets in days from today; negative = past) ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  /** 'YYYY-MM-DD' (local) for today + offset days */
  function day(offset) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /** ISO timestamp for N days ago at local time 'HH:MM'; never in the future. */
  function ago(daysAgo, time) {
    const [h, m] = (time || '10:00').split(':').map(Number);
    const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0);
    const now = Date.now();
    if (d.getTime() > now) d.setTime(now - (20 + daysAgo) * 60000);
    return d.toISOString();
  }

  const LABEL = { assessment: 'Free assessment', site_visit: 'Site visit', in_progress: 'In progress', completed: 'Completed' };
  function moved(from, to, note) { return 'Moved from ' + LABEL[from] + ' to ' + LABEL[to] + (note ? ' — ' + note : ''); }

  const ALL_CHECKS = ['power', 'network_closet', 'isp', 'mounting', 'wifi_survey', 'lighting', 'storage', 'remote_view'];
  function checklist(missing) {
    const out = {}; ALL_CHECKS.forEach(k => { out[k] = !(missing || []).includes(k); }); return out;
  }

  /**
   * Build a client from a compact spec.
   * spec.log = [[daysAgo, type, text, 'HH:MM'], ...] — sorted newest first here.
   */
  function build(spec, uid) {
    const acts = spec.log.map(([d, type, text, t]) => ({ id: uid('ac'), type, at: ago(d, t), text }));
    acts.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
    const oldest = acts[acts.length - 1];
    const lastStage = acts.find(a => a.type === 'stage');
    const c = Object.assign({}, spec);
    delete c.log;
    c.activities = acts;
    c.createdAt = oldest ? oldest.at : ago(1);
    c.stageChangedAt = lastStage ? lastStage.at : c.createdAt;
    c.updatedAt = acts[0] ? acts[0].at : c.createdAt;
    c.tags = c.tags || [];
    return c;
  }

  function generate() {
    const U = RS.util;
    const uid = U.uid;
    const S = RS.SERVICES; // ['Security Cameras','Network Installation','Network Management','Maintenance & Support']
    const CAM = S[0], NET = S[1], MGMT = S[2], MAINT = S[3];
    const MG = 'Michael Gooding', AT = 'Andre Thomas';

    const id = {};
    ['villa', 'dive', 'dental', 'school', 'bistro', 'guest', 'church', 'marina', 'jewel', 'propmgmt', 'canebay', 'water', 'condo', 'auto']
      .forEach(k => { id[k] = uid('cl'); });

    const specs = [
      /* ===================== Free assessment (4) ===================== */
      {
        id: id.villa, name: 'Laura Hendricks', company: '', phone: '(340) 555-0112', email: 'laura.hendricks@example.com',
        address: '14 Estate Peterborg, Northside', island: 'St. Thomas', source: 'Website form',
        services: [CAM, NET], stage: 'assessment', priority: 'high',
        equipment: { cameras: 8, accessPoints: 3, switches: 1, routers: 1 }, quote: 6800,
        notes: 'Hillside rental villa, 3 levels plus pool deck. Guests complain Wi-Fi drops on the lower bedroom level. Owner lives stateside; property manager meets on site.',
        assessment: { requestedAt: day(-3), scheduledFor: day(2), completedAt: '', status: 'scheduled', findings: '', recommendations: '', estimate: 0, free: true },
        followUpOn: day(0),
        log: [
          [3, 'note', 'Client added (Website form)', '08:12'],
          [3, 'call', 'Returned web inquiry. Wants cameras on the driveway gate and pool deck, plus Wi-Fi that reaches the lower suite.', '10:40'],
          [2, 'email', 'Sent assessment confirmation for ' + U.fmtDate(day(2)) + ' at 10:00. Asked for gate code and ISP account details.', '09:05'],
          [1, 'text', 'Property manager replied: gate code 4412, Liberty fiber at the house.', '16:22'],
        ],
      },
      {
        id: id.dive, name: 'Keisha Penn', company: 'Coral Bay Divers', phone: '(340) 555-0127', email: 'keisha@coralbaydivers.example.com',
        address: 'Route 107, Coral Bay', island: 'St. John', source: 'Social media',
        services: [CAM], stage: 'assessment', priority: 'normal',
        equipment: { cameras: 6, accessPoints: 1, switches: 1, routers: 1 }, quote: 0,
        notes: 'Dive shop with tank storage out back. Two break-ins on the gear shed this year. Wants to view cameras from her phone while out on the boat.',
        assessment: { requestedAt: day(-1), scheduledFor: '', completedAt: '', status: 'requested', findings: '', recommendations: '', estimate: 0, free: true },
        followUpOn: day(1),
        log: [
          [1, 'note', 'Client added (Social media)', '13:30'],
          [1, 'text', 'Messaged back from Facebook inquiry. She prefers mornings before 8:30 when the boat goes out.', '15:10'],
        ],
      },
      {
        id: id.dental, name: 'Dr. Anita Rhymer', company: 'Harbor View Dental', phone: '(340) 555-0134', email: 'frontdesk@harborviewdental.example.com',
        address: '5 Company Street, Christiansted', island: 'St. Croix', source: 'Referral',
        services: [NET, MGMT], stage: 'assessment', priority: 'normal',
        equipment: { cameras: 4, accessPoints: 2, switches: 1, routers: 1 }, quote: 0,
        notes: 'Four operatories plus front desk. Imaging PCs share the patient Wi-Fi today; needs a separate staff network. Referred by Islandwide Property Management.',
        assessment: { requestedAt: day(-12), scheduledFor: '', completedAt: '', status: 'requested', findings: '', recommendations: '', estimate: 0, free: true },
        followUpOn: day(-2),
        log: [
          [12, 'note', 'Client added (Referral)', '09:00'],
          [12, 'call', 'Intro call with office manager. Main concern is the X-ray workstation dropping off the network mid-scan.', '11:15'],
          [9, 'email', 'Sent available assessment dates for the St. Croix trip. No reply yet.', '14:02'],
        ],
      },
      {
        id: id.school, name: 'Marisol Encarnacion', company: 'Bovoni Hills Montessori', phone: '(340) 555-0141', email: 'office@bovonimontessori.example.com',
        address: 'Estate Bovoni, East End', island: 'St. Thomas', source: 'Phone call',
        services: [CAM, NET], stage: 'assessment', priority: 'normal',
        equipment: { cameras: 10, accessPoints: 5, switches: 2, routers: 1 }, quote: 0,
        notes: 'Small school, 6 classrooms across two buildings. Board wants entrance cameras and a classroom Wi-Fi refresh before the January term.',
        assessment: { requestedAt: day(-5), scheduledFor: day(6), completedAt: '', status: 'scheduled', findings: '', recommendations: '', estimate: 0, free: true },
        followUpOn: day(5),
        log: [
          [5, 'note', 'Client added (Phone call)', '10:20'],
          [5, 'call', 'Head of school called in. Budget is board-approved up to about $12k; needs two quotes for the board.', '10:25'],
          [4, 'email', 'Confirmed walk-through for ' + U.fmtDate(day(6)) + ' after dismissal (3:30 PM).', '08:45'],
        ],
      },

      /* ===================== Site visit (3) ===================== */
      {
        id: id.bistro, name: 'Marcus Lettsome', company: 'Bonefish Bistro', phone: '(340) 555-0153', email: 'marcus@bonefishbistro.example.com',
        address: '22 Rue de St. Barthelemy, Frenchtown', island: 'St. Thomas', source: 'Walk-in',
        services: [CAM, NET, MAINT], stage: 'site_visit', priority: 'high',
        equipment: { cameras: 9, accessPoints: 3, switches: 1, routers: 1 }, quote: 8400,
        notes: 'Waterfront restaurant with open-air deck. POS tablets lose Wi-Fi on the deck during dinner service. Wants cameras on register, bar and back door.',
        assessment: { requestedAt: day(-15), scheduledFor: day(-10), completedAt: day(-8), status: 'completed',
          findings: 'Single consumer router behind the bar; deck is 80 ft from it through a concrete wall. Existing 4-camera DVR is analog and two cameras are dead. Salt corrosion on exterior mounts.',
          recommendations: 'Two outdoor-rated APs for the deck plus one indoor, a PoE switch in the office closet, 9 IP cameras with a 4 TB NVR, and a separate guest network.',
          estimate: 8400, free: true },
        siteVisit: { date: day(2), time: '09:30', status: 'scheduled', technician: MG, checklist: {}, notes: 'Arrive before lunch prep. Park on the side lot.', completedAt: '', survey: { cameras: 0, accessPoints: 0, switches: 0, routers: 0 } },
        followUpOn: day(0),
        log: [
          [15, 'note', 'Client added (Walk-in)', '15:00'],
          [10, 'meeting', 'Free assessment on site with Marcus during the afternoon lull.', '14:30'],
          [8, 'stage', moved('assessment', 'site_visit', 'assessment complete'), '09:10'],
          [7, 'email', 'Sent estimate for 9-camera system with NVR and deck Wi-Fi, $8,400.', '11:00'],
          [3, 'call', 'Called to confirm the site visit; he wants to measure cable runs before signing.', '10:15'],
          [1, 'text', 'Reminder sent for ' + U.fmtShort(day(2)) + ' 9:30 AM site visit.', '17:40'],
        ],
      },
      {
        id: id.guest, name: 'Ellen Sprauve', company: 'Mongoose Hill Guesthouse', phone: '(340) 555-0168', email: 'stay@mongoosehill.example.com',
        address: 'Gift Hill Road, Cruz Bay', island: 'St. John', source: 'Referral',
        services: [NET, MGMT], stage: 'site_visit', priority: 'normal',
        equipment: { cameras: 2, accessPoints: 4, switches: 1, routers: 1 }, quote: 5200,
        notes: 'Seven-room guesthouse on a steep lot. Guests leave reviews about weak Wi-Fi in the upper cottages. Wants remote management so she does not have to reboot gear herself.',
        assessment: { requestedAt: day(-21), scheduledFor: day(-16), completedAt: day(-16), status: 'completed',
          findings: 'Mesh units are daisy-chained wirelessly across three buildings; throughput drops below 5 Mbps at the top cottage. No UPS on the modem.',
          recommendations: 'Run outdoor-rated Cat6 to each cottage, four wired APs, managed switch with monitoring, UPS for modem and switch.',
          estimate: 5200, free: true },
        siteVisit: { date: day(6), time: '13:00', status: 'scheduled', technician: AT, checklist: {}, notes: 'Take the 11:00 ferry from Red Hook. Bring the long ladder.', completedAt: '', survey: { cameras: 0, accessPoints: 0, switches: 0, routers: 0 } },
        followUpOn: day(5),
        log: [
          [21, 'note', 'Client added (Referral)', '12:00'],
          [16, 'meeting', 'Free assessment walk-through of all three buildings with Ellen.', '10:00'],
          [16, 'stage', moved('assessment', 'site_visit'), '15:20'],
          [14, 'email', 'Sent Wi-Fi coverage findings and estimate, $5,200 including monthly management.', '09:30'],
          [6, 'call', 'Agreed on site visit date; she will block the top cottage that afternoon.', '16:05'],
        ],
      },
      {
        id: id.church, name: 'Rev. Calvin Matthias', company: 'Bethany Hill Community Church', phone: '(340) 555-0172', email: 'office@bethanyhill.example.com',
        address: 'Estate Contant, Charlotte Amalie', island: 'St. Thomas', source: 'Business card / QR',
        services: [CAM], stage: 'site_visit', priority: 'low',
        equipment: { cameras: 7, accessPoints: 2, switches: 1, routers: 0 }, quote: 4600,
        notes: 'Wants cameras for the parking lot and fellowship hall, plus Wi-Fi for livestreaming Sunday service. Decision goes to the church council.',
        assessment: { requestedAt: day(-38), scheduledFor: day(-33), completedAt: day(-33), status: 'completed',
          findings: 'Parking lot is unlit on the north side. Livestream laptop is on a phone hotspot. Electrical room has space for a small rack.',
          recommendations: '7 cameras with night vision, 2 APs for sanctuary and hall, small PoE switch. Add a motion floodlight on the north lot.',
          estimate: 4600, free: true },
        siteVisit: { date: '', time: '', status: 'not_scheduled', technician: '', checklist: {}, notes: '', completedAt: '', survey: { cameras: 0, accessPoints: 0, switches: 0, routers: 0 } },
        followUpOn: day(-6),
        log: [
          [38, 'note', 'Client added (Business card / QR)', '11:00'],
          [33, 'meeting', 'Free assessment after midweek service with Rev. Matthias and the deacon.', '18:30'],
          [32, 'stage', moved('assessment', 'site_visit'), '09:00'],
          [30, 'email', 'Sent proposal for 7-camera system and sanctuary Wi-Fi, $4,600.', '10:45'],
          [24, 'call', 'Left voicemail; council meets end of month to vote on the budget.', '14:15'],
        ],
      },

      /* ===================== In progress (4) ===================== */
      {
        id: id.marina, name: 'Dwayne Callwood', company: 'Red Hook Harbor Marina', phone: '(340) 555-0185', email: 'dockmaster@redhookharbor.example.com',
        address: 'Red Hook Plaza, Red Hook', island: 'St. Thomas', source: 'Repeat client',
        services: [CAM, NET, MGMT], stage: 'in_progress', priority: 'high',
        equipment: { cameras: 16, accessPoints: 6, switches: 3, routers: 2 }, quote: 21500,
        notes: 'Marina office, fuel dock and three piers. Slip tenants need Wi-Fi on the docks. Insurance requires camera coverage of the fuel dock before renewal in January.',
        assessment: { requestedAt: day(-52), scheduledFor: day(-48), completedAt: day(-48), status: 'completed',
          findings: 'Existing cameras cover only the office. Dock Wi-Fi is a single AP on the office roof. Fiber enters the office; no backup WAN.',
          recommendations: '16 IP cameras (4 PTZ for piers), 6 outdoor APs on dock poles, 3 PoE switches in weatherproof enclosures, dual-WAN routers with LTE failover.',
          estimate: 21500, free: true },
        siteVisit: { date: day(-41), time: '08:00', status: 'completed', technician: MG, checklist: checklist([]), completedAt: day(-41),
          notes: 'Pier C needs a conduit run under the boardwalk. Confirmed pole mounts with harbor master. Fuel dock camera needs explosion-proof housing spec check.',
          survey: { cameras: 17, accessPoints: 6, switches: 3, routers: 2 } },
        job: { startedAt: day(-30), completedAt: '', progress: 60, invoice: 21500, paid: false },
        followUpOn: day(3),
        log: [
          [52, 'note', 'Client added (Repeat client)', '09:00'],
          [48, 'meeting', 'Free assessment with Dwayne and the harbor master, walked all three piers.', '08:30'],
          [47, 'stage', moved('assessment', 'site_visit'), '10:00'],
          [41, 'meeting', 'Site visit: measured conduit runs on Pier C and the fuel dock.', '08:00'],
          [36, 'email', 'Sent final quote for 16-camera system, dock Wi-Fi and failover, $21,500. 50% deposit terms.', '15:30'],
          [31, 'call', 'Deposit received. Scheduled install start.', '11:20'],
          [30, 'stage', moved('site_visit', 'in_progress', 'deposit received'), '11:25'],
          [9, 'note', 'Piers A and B cameras live. Dock APs installed on A and B.', '17:00'],
          [2, 'call', 'Dwayne asked to move Pier C work to weekday mornings; charter traffic is heavy on weekends.', '09:40'],
        ],
      },
      {
        id: id.jewel, name: 'Priya Ramchandani', company: 'Dronningens Gold & Gems', phone: '(340) 555-0193', email: 'priya@dronningensgold.example.com',
        address: '31 Main Street (Dronningens Gade), Charlotte Amalie', island: 'St. Thomas', source: 'Walk-in',
        services: [CAM, MAINT], stage: 'in_progress', priority: 'high',
        equipment: { cameras: 12, accessPoints: 2, switches: 1, routers: 1 }, quote: 9400,
        notes: 'Jewelry shop on Main Street; cruise ship days are the busiest. Needs 4K coverage of every display case and the safe room. Install work after 5 PM only.',
        assessment: { requestedAt: day(-34), scheduledFor: day(-32), completedAt: day(-32), status: 'completed',
          findings: 'Current 1080p cameras cannot read faces at the door. NVR has 7 days retention; insurer wants 30.',
          recommendations: '12 4K cameras with face-capture at the entrance, 8 TB NVR for 30-day retention, offsite clip backup, maintenance plan.',
          estimate: 9400, free: true },
        siteVisit: { date: day(-25), time: '17:30', status: 'completed', technician: AT, checklist: checklist(['wifi_survey']), completedAt: day(-25),
          notes: 'Ceiling is tin; use surface boxes. Safe room needs a dedicated camera on its own circuit.',
          survey: { cameras: 13, accessPoints: 2, switches: 1, routers: 1 } },
        job: { startedAt: day(-6), completedAt: '', progress: 35, invoice: 9400, paid: false },
        followUpOn: day(1),
        log: [
          [34, 'note', 'Client added (Walk-in)', '11:30'],
          [32, 'meeting', 'Free assessment after closing. Reviewed insurer requirements letter.', '17:15'],
          [31, 'stage', moved('assessment', 'site_visit'), '09:00'],
          [25, 'meeting', 'Site visit with Andre: mapped all 12 display-case angles.', '17:30'],
          [20, 'email', 'Sent quote for 12 x 4K cameras, 8 TB NVR and maintenance plan, $9,400.', '10:10'],
          [7, 'call', 'Priya approved the quote. Install evenings starting next week.', '13:45'],
          [6, 'stage', moved('site_visit', 'in_progress'), '13:50'],
          [1, 'text', 'Confirmed tonight 5:30 PM for display-case cameras, phase 2 of 3.', '12:05'],
        ],
      },
      {
        id: id.propmgmt, name: 'Sandra Petersen', company: 'Islandwide Property Management', phone: '(340) 555-0106', email: 'sandra@islandwidepm.example.com',
        address: 'Raphune Hill, Suite 4', island: 'St. Thomas', source: 'Referral',
        services: [NET, MGMT, MAINT], stage: 'in_progress', priority: 'normal',
        equipment: { cameras: 10, accessPoints: 8, switches: 4, routers: 3 }, quote: 14200,
        notes: 'Manages 22 rental units across three buildings. Wants one managed network with remote monitoring so tenants stop calling about Wi-Fi outages.',
        assessment: { requestedAt: day(-58), scheduledFor: day(-55), completedAt: day(-55), status: 'completed',
          findings: 'Each building has a different ISP router with default passwords. No central monitoring. Two buildings share one ancient switch.',
          recommendations: 'Standardize on managed routers and switches, 8 APs, VLAN per unit, 10 common-area cameras, monthly management contract.',
          estimate: 14200, free: true },
        siteVisit: { date: day(-50), time: '09:00', status: 'completed', technician: MG, checklist: checklist(['lighting']), completedAt: day(-50),
          notes: 'Building C network closet floods in heavy rain; relocate to the upstairs utility room.',
          survey: { cameras: 10, accessPoints: 9, switches: 4, routers: 3 } },
        job: { startedAt: day(-40), completedAt: '', progress: 80, invoice: 14200, paid: false },
        followUpOn: day(2),
        log: [
          [58, 'note', 'Client added (Referral)', '10:00'],
          [55, 'meeting', 'Free assessment across all three buildings.', '09:00'],
          [54, 'stage', moved('assessment', 'site_visit'), '08:30'],
          [50, 'meeting', 'Site visit: closet survey and AP placement for each building.', '09:00'],
          [42, 'email', 'Sent proposal: network standardization plus $350/month management.', '16:00'],
          [40, 'stage', moved('site_visit', 'in_progress', 'contract signed'), '11:00'],
          [18, 'note', 'Buildings A and B cut over to the new network. Building C closet relocation pending.', '17:30'],
          [4, 'email', 'Sent Building C cutover plan and tenant notice draft.', '10:30'],
        ],
      },
      {
        id: id.canebay, name: 'Gregory Hodge', company: '', phone: '(340) 555-0119', email: 'ghodge@example.com',
        address: 'Estate Cane Bay, North Shore', island: 'St. Croix', source: 'Website form',
        services: [CAM], stage: 'in_progress', priority: 'normal',
        equipment: { cameras: 6, accessPoints: 2, switches: 1, routers: 1 }, quote: 3900,
        notes: 'Second-home villa, empty most of hurricane season. Wants cameras with cellular backup so he can check on the house after storms.',
        assessment: { requestedAt: day(-45), scheduledFor: day(-42), completedAt: day(-42), status: 'completed',
          findings: 'House is on a generator transfer switch. No existing cameras. Cell signal is decent on the upper floor.',
          recommendations: '6 cameras with local NVR, LTE failover router, UPS so cameras survive the generator switchover.',
          estimate: 3900, free: true },
        siteVisit: { date: day(-35), time: '10:30', status: 'completed', technician: AT, checklist: checklist(['network_closet', 'storage']), completedAt: day(-35),
          notes: 'No closet; mount NVR in the pantry cabinet with ventilation. Caretaker Mr. Joseph has keys.',
          survey: { cameras: 6, accessPoints: 2, switches: 1, routers: 1 } },
        job: { startedAt: day(-23), completedAt: '', progress: 15, invoice: 3900, paid: false },
        followUpOn: day(4),
        log: [
          [45, 'note', 'Client added (Website form)', '20:15'],
          [42, 'meeting', 'Free assessment with caretaker on site; Gregory joined by video call.', '10:00'],
          [41, 'stage', moved('assessment', 'site_visit'), '09:00'],
          [35, 'meeting', 'Site visit: picked camera spots for driveway, gate and both decks.', '10:30'],
          [24, 'email', 'Quote accepted, $3,900. Deposit paid by bank transfer.', '14:00'],
          [23, 'stage', moved('site_visit', 'in_progress'), '14:05'],
          [21, 'note', 'Cable runs done. Waiting on PoE switch and LTE router shipment from Miami.', '16:40'],
        ],
      },

      /* ===================== Completed (3) ===================== */
      {
        id: id.water, name: 'Thomas & Renee Abramson', company: '', phone: '(340) 555-0124', email: 'abramson.family@example.com',
        address: 'Sprat Point Road', island: 'Water Island', source: 'Referral',
        services: [CAM, NET], stage: 'completed', priority: 'normal',
        equipment: { cameras: 8, accessPoints: 3, switches: 1, routers: 1 }, quote: 7200,
        notes: 'Full-time residents. Hillside home with a long staircase down to the dock. Asked for hurricane shutters to stay clear of camera mounts.',
        assessment: { requestedAt: day(-56), scheduledFor: day(-53), completedAt: day(-53), status: 'completed',
          findings: 'Wi-Fi does not reach the dock or guest cottage. Old cameras are Wi-Fi battery units that die after storms.',
          recommendations: '8 wired PoE cameras, 3 APs including one outdoor for the dock, UPS on the network gear.',
          estimate: 7200, free: true },
        siteVisit: { date: day(-47), time: '09:00', status: 'completed', technician: MG, checklist: checklist([]), completedAt: day(-47),
          notes: 'Bring gear over on the Water Island ferry; golf cart available at the dock.',
          survey: { cameras: 8, accessPoints: 3, switches: 1, routers: 1 } },
        job: { startedAt: day(-28), completedAt: day(-14), progress: 100, invoice: 7200, paid: true },
        followUpOn: '',
        log: [
          [56, 'note', 'Client added (Referral)', '09:30'],
          [53, 'meeting', 'Free assessment; walked the staircase and dock with Thomas.', '09:00'],
          [52, 'stage', moved('assessment', 'site_visit'), '10:00'],
          [47, 'meeting', 'Site visit: confirmed outdoor AP on the dock piling.', '09:00'],
          [29, 'call', 'Approved the quote, $7,200.', '15:00'],
          [28, 'stage', moved('site_visit', 'in_progress'), '15:05'],
          [14, 'stage', moved('in_progress', 'completed', 'walk-through signed off'), '16:00'],
          [12, 'email', 'Invoice paid in full. Sent app setup guide for remote viewing.', '10:00'],
          [10, 'text', 'Renee sent thanks: dock camera is crystal clear at night.', '19:20'],
        ],
      },
      {
        id: id.condo, name: 'Howard Brin', company: 'Sapphire Bay Condo Association', phone: '(340) 555-0148', email: 'board@sapphirebaycondos.example.com',
        address: 'Sapphire Bay, East End', island: 'St. Thomas', source: 'Phone call',
        services: [CAM, MAINT], stage: 'completed', priority: 'normal',
        equipment: { cameras: 14, accessPoints: 0, switches: 2, routers: 1 }, quote: 12800,
        notes: 'Condo association: pool, parking, mailroom and beach access gate. Good candidate for an annual maintenance plan before next hurricane season.',
        assessment: { requestedAt: day(-60), scheduledFor: day(-58), completedAt: day(-58), status: 'completed',
          findings: 'Analog cameras with water damage on four units. Gate area is dark after 7 PM.',
          recommendations: '14 IP cameras with IR, 2 PoE switches, NVR in the office, quarterly cleaning of lenses and housings.',
          estimate: 12800, free: true },
        siteVisit: { date: day(-55), time: '08:30', status: 'completed', technician: MG, checklist: checklist(['wifi_survey']), completedAt: day(-55),
          notes: 'Board approved removal of old analog cable. Pool camera needs a taller pole.',
          survey: { cameras: 15, accessPoints: 0, switches: 2, routers: 1 } },
        job: { startedAt: day(-52), completedAt: day(-40), progress: 100, invoice: 12800, paid: true },
        followUpOn: '',
        log: [
          [60, 'note', 'Client added (Phone call)', '09:00'],
          [58, 'meeting', 'Free assessment with the board president.', '08:30'],
          [57, 'stage', moved('assessment', 'site_visit'), '09:00'],
          [55, 'meeting', 'Site visit: survey of pool, parking and gate.', '08:30'],
          [52, 'stage', moved('site_visit', 'in_progress', 'board approved'), '10:00'],
          [40, 'stage', moved('in_progress', 'completed'), '15:30'],
          [35, 'email', 'Final invoice paid. Offered annual maintenance plan; board to discuss at next meeting.', '11:00'],
        ],
      },
      {
        id: id.auto, name: 'Rafael Maduro', company: 'Tutu Auto Supply', phone: '(340) 555-0157', email: 'rafael@tutuauto.example.com',
        address: 'Estate Tutu, near Tutu Park Mall', island: 'St. Thomas', source: 'Business card / QR',
        services: [CAM, NET], stage: 'completed', priority: 'normal',
        equipment: { cameras: 10, accessPoints: 2, switches: 1, routers: 1 }, quote: 6900,
        notes: 'Parts store with a fenced yard. Shrinkage at the counter; wants camera views of the register and the yard gate on his phone.',
        assessment: { requestedAt: day(-40), scheduledFor: day(-38), completedAt: day(-38), status: 'completed',
          findings: 'No cameras on the yard. Counter PC and card machine share a consumer router with the shop radio streaming.',
          recommendations: '10 cameras (2 on the counter), separate VLAN for card machine, 2 APs for warehouse scanners.',
          estimate: 6900, free: true },
        siteVisit: { date: day(-33), time: '07:30', status: 'completed', technician: AT, checklist: checklist(['lighting']), completedAt: day(-33),
          notes: 'Yard gate needs a pole mount; wall is block. Open 7:30 AM, work before customers arrive.',
          survey: { cameras: 10, accessPoints: 2, switches: 1, routers: 1 } },
        job: { startedAt: day(-17), completedAt: day(-5), progress: 100, invoice: 6900, paid: false },
        followUpOn: day(2),
        log: [
          [40, 'note', 'Client added (Business card / QR)', '12:00'],
          [38, 'meeting', 'Free assessment before opening.', '07:30'],
          [37, 'stage', moved('assessment', 'site_visit'), '09:00'],
          [33, 'meeting', 'Site visit with Andre: yard pole location agreed.', '07:30'],
          [18, 'call', 'Rafael approved the $6,900 quote.', '12:30'],
          [17, 'stage', moved('site_visit', 'in_progress'), '12:35'],
          [5, 'stage', moved('in_progress', 'completed'), '16:45'],
          [4, 'email', 'Sent final invoice, $6,900, net 15.', '09:00'],
          [1, 'call', 'Rafael said check goes out Friday; asked about adding a camera at the loading bay.', '14:20'],
        ],
      },
    ];

    const clients = specs.map(s => build(s, uid));

    const reviews = [
      { clientId: id.water, author: 'Renee Abramson', rating: 5, source: 'Google', at: day(-10), featured: true,
        text: 'Michael and his crew ran wired cameras all the way down our hillside to the dock. Night picture is so clear we can read the boat registration. Wi-Fi finally works in the guest cottage too.',
        reply: 'Thank you, Renee. That staircase was a workout. Enjoy the dock camera, and call us before storm season if you want the gear checked.' },
      { clientId: id.condo, author: 'Howard Brin', rating: 5, source: 'Direct', at: day(-36),
        text: 'Replaced our water-damaged analog system on time and on budget. The gate camera now shows plates after dark. Professional with the board and residents.', reply: '' },
      { clientId: id.condo, author: 'Lisa Fahie', rating: 4, source: 'Facebook', at: day(-33),
        text: 'Pool and parking cameras look great. Install took a few days longer than planned because of rain, but they kept us updated every day.',
        reply: 'Thanks, Lisa. The rain set us back two days; glad the daily updates helped.' },
      { clientId: id.auto, author: 'Rafael Maduro', rating: 5, source: 'Google', at: day(-3),
        text: 'Quick, clean install. I can see the counter and the yard gate from my phone. Card machine is on its own network now and has not dropped once.', reply: '' },
      { clientId: id.marina, author: 'Dwayne Callwood', rating: 5, source: 'Website', at: day(-8),
        text: 'Second project with Reliable Solutions. Piers A and B have cameras and dock Wi-Fi already and slip tenants noticed right away. They answer the phone, which is rare on island.',
        reply: 'Appreciate you, Dwayne. Pier C is next on the weekday schedule.' },
      { clientId: id.propmgmt, author: 'Sandra Petersen', rating: 4, source: 'Google', at: day(-15),
        text: 'Tenant Wi-Fi complaints have dropped to almost zero in the first two buildings. Communication on the cutover schedule could have been earlier, but the work itself is solid.', reply: '' },
      { clientId: id.jewel, author: 'Priya Ramchandani', rating: 3, source: 'Direct', at: day(-2),
        text: 'The new 4K cameras on the cases are excellent. One evening session started late and we had to stay past 8. Hoping the last phase stays on time.',
        reply: 'Priya, sorry about the late start. Andre will be there at 5:30 sharp for the remaining sessions.' },
      { clientId: '', author: 'Kareem Liburd', rating: 5, source: 'Google', at: day(-20),
        text: 'Called them the week before a tropical storm to secure our shop cameras and add a UPS. Same-day response and everything stayed online through the outage.', reply: '' },
      { clientId: '', author: 'Janelle Turnbull', rating: 4, source: 'Facebook', at: day(-44),
        text: 'Got Wi-Fi working across our three-level house on the hill. Fair price and they explained everything without the jargon.', reply: '' },
    ].map(r => Object.assign({ id: uid('rv'), reply: '', featured: false }, r));

    return { clients, reviews };
  }

  RS.seed = function () {
    const { clients, reviews } = generate();
    RS.store.replaceAll(clients, reviews, { seeded: true, demo: true, createdAt: new Date().toISOString() });
  };
  RS.seedDemo = RS.seed;
})();
