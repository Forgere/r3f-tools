import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AnimatedInstancesExample } from "./AnimatedInstancesExample";
import GSAPAnimationExample from "./GSAPAnimationExample";
import PathAnimationExample from "./PathAnimationExample";

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: 'rgba(0,0,0,0.8)',
          padding: '10px 20px',
          zIndex: 1000,
          display: 'flex',
          gap: '20px'
        }}>
          <Link 
            to="/" 
            style={{ color: 'white', textDecoration: 'none', padding: '5px 10px' }}
          >
            Instanced Mesh
          </Link>
          <Link 
            to="/gsap-animation" 
            style={{ color: 'white', textDecoration: 'none', padding: '5px 10px' }}
          >
            GSAP Animation
          </Link>
          <Link 
            to="/path-animation" 
            style={{ color: 'white', textDecoration: 'none', padding: '5px 10px' }}
          >
            Path Animation
          </Link>
        </nav>
        
        <div style={{ paddingTop: '60px' }}>
          <Routes>
            <Route path="/" element={<AnimatedInstancesExample />} />
            <Route path="/gsap-animation" element={<GSAPAnimationExample />} />
            <Route path="/path-animation" element={<PathAnimationExample />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

const root = createRoot(container);
root.render(<App />);
