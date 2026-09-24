import Panel from './Panel.jsx';
import Magnetic from './Magnetic.jsx';
import SecHead from './SecHead.jsx';

const FEATURES = [
  { title: 'Autonomous Navigation', desc: 'Safe rover movement across complex lunar terrain via intelligent, physics-aware path planning.' },
  { title: 'Real NASA Terrain Data', desc: 'High-resolution DEM data from NASA LRO LOLA drives realistic simulation and decision-making.' },
  { title: 'AI Anomaly Detection', desc: 'An Isolation Forest model flags abnormal rover sensor behavior the instant it happens.' },
  { title: 'Real-Time Telemetry', desc: 'Live battery, tilt, temperature, and comms-signal streaming over WebSocket, once per second.' },
  { title: 'Autonomous Rerouting', desc: 'The AI copilot replans the route and adjusts rover behavior automatically the moment a fault fires.' },
  { title: 'Offline-First Reliability', desc: 'Terrain datasets are preprocessed and preloaded, so the system runs without a live internet dependency.' },
  { title: '3D Terrain Visualization', desc: 'Interactive rendering of the rover path and movement across real lunar elevation data.' },
  { title: 'Balanced Path Planning', desc: 'A* search weighs slope-based safety against travel efficiency on every single route.' },
];

const TECH_STACK = [
  'Three.js', 'FastAPI', 'Python', 'Scikit-learn · Isolation Forest',
  'WebSocket', 'NASA LRO LOLA DEM', 'A* Pathfinding', 'Bekker-Wong Terramechanics',
];

const TEAM = [
  { role: 'Team Leader', name: 'Saniya Kumari', id: '25BCE7920', email: 'saniya.25bce7920@vitapstudent.ac.in', gender: 'Female', phone: '6299291718' },
  { role: 'Team Member 1', name: 'Purabi Basak', id: '25BCE7822', email: 'purabi.25bce7822@vitapstudent.ac.in', gender: 'Female', phone: '9062759288' },
  { role: 'Team Member 2', name: 'Navya Jain', id: '25BCE7713', email: 'navya.25bce7713@vitapstudent.ac.in', gender: 'Female', phone: '9760957974' },
  { role: 'Team Member 3', name: 'Avinash Kumar', id: '25BCE7169', email: 'avinash.25bce7169@vitapstudent.ac.in', gender: 'Male', phone: '8800825461' },
  { role: 'Team Member 4', name: 'Samit Verma', id: '25BCE7975', email: 'samit.25bce7975@vitapstudent.ac.in', gender: 'Male', phone: '9315664119' },
  { role: 'Team Member 5', name: 'Dheeraj Soni', id: '25BCE7372', email: 'dheeraj.25bce7372@vitapstudent.ac.in', gender: 'Male', phone: '8529379833' },
];

export default function HomeTab({ onEnter, trigger }) {
  return (
    <div className="flex-col" style={{ gap: 40 }}>
      {/* ── Hero ── */}
      <section className="home-hero">
        <div className="home-badges">
          <span className="chip">PS ID · SIH26209</span>
          <span className="chip">SPACE TECHNOLOGY</span>
          <span className="chip">SOFTWARE</span>
          <span className="chip">TEAM ORBITIQ</span>
        </div>
        <h1 className="home-title">Autonomous Lunar<br />Rover Control System</h1>
        <p className="home-tagline">
          Built by <strong>Team OrbitIQ</strong> for Smart India Hackathon 2026 — an AI mission
          copilot that navigates a lunar rover across real NASA terrain, watches its telemetry
          live, and autonomously replans the moment something goes wrong.
        </p>
        <div className="btn-row">
          <Magnetic><button className="btn primary" data-cx="ENTER" onClick={onEnter}>Enter Mission Console</button></Magnetic>
        </div>
      </section>

      {/* ── About ── */}
      <section>
        <SecHead title="About The Project" trigger={trigger} />
        <Panel>
          <p className="home-about-p">
            <strong>Mission Copilot</strong> is a full-stack simulation platform for an autonomous
            lunar rover. Real elevation data from NASA's Lunar Reconnaissance Orbiter (LRO LOLA)
            is processed into a slope-and-cost grid; an A* planner routes the rover across it while
            a Bekker-Wong terramechanics model predicts how each wheel behaves on lunar regolith.
            An onboard Random Forest / Isolation Forest anomaly detector watches live telemetry —
            battery, motor temperature, tilt, comms signal — and when something looks wrong, an AI
            agent reasons about the fault and autonomously replans the path, changes mode, or slows
            the rover down. Everything runs offline-first on preprocessed terrain data, so the demo
            never depends on a live external API.
          </p>
        </Panel>
      </section>

      {/* ── 3D Terrain Viewer ── */}
      <section>
        <SecHead title="3D Terrain Viewer" meta="Three.js · opens in a new tab" trigger={trigger} />
        <Panel className="flex-col">
          <p className="home-about-p" style={{ marginBottom: 16 }}>
            The rover's real NASA DEM terrain, rendered as an interactive 3D mesh with live rover
            animation, slope heatmaps, and learned-traversability overlays. Double-click the terrain
            to set a new rover goal, drag to rotate, scroll to zoom — press <strong>H</strong> for
            elevation mode, <strong>S</strong> for the slope heatmap, or <strong>L</strong> for
            learned traversability. It talks directly to the same FastAPI backend as the mission
            console, so it needs that running too.
          </p>
          <div className="btn-row">
            <Magnetic>
              <a className="btn primary" data-cx="LAUNCH" href="/terrain.html" target="_blank" rel="noopener noreferrer">
                Launch 3D Terrain Viewer ↗
              </a>
            </Magnetic>
          </div>
        </Panel>
      </section>

      {/* ── Properties / features ── */}
      <section>
        <SecHead title="Software Properties" meta={`${FEATURES.length} core capabilities`} trigger={trigger} />
        <div className="grid feature-grid">
          {FEATURES.map(f => (
            <Panel key={f.title} className="feature-card">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </Panel>
          ))}
        </div>
      </section>

      {/* ── Tech stack ── */}
      <section>
        <SecHead title="Tech Stack" trigger={trigger} />
        <div className="tech-chips">
          {TECH_STACK.map(t => <span key={t} className="chip">{t}</span>)}
        </div>
      </section>

      {/* ── Team ── */}
      <section>
        <SecHead title="Team OrbitIQ" meta={`${TEAM.length} members`} trigger={trigger} />
        <div className="grid team-grid">
          {TEAM.map(m => (
            <Panel key={m.id} className="team-card">
              <span className="team-role">{m.role}</span>
              <h3>{m.name}</h3>
              <div className="team-meta">
                <span>{m.id}</span>
                <span>{m.gender}</span>
              </div>
              <a className="team-contact" href={`mailto:${m.email}`}>{m.email}</a>
              <a className="team-contact" href={`tel:+91${m.phone}`}>+91 {m.phone}</a>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  );
}
