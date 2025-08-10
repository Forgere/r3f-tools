import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AnimatedInstancesExample } from "./AnimatedInstancesExample";
import { ConveyorBeltExample } from "./ConveyorBeltExample";
import { EditableConveyorBeltExample } from "./EditableConveyorBeltExample";
import GSAPAnimationExample from "./GSAPAnimationExample";
import PathAnimationExample from "./PathAnimationExample";
import { PhysicsConveyorBeltExample } from "./PhysicsConveyorBeltExample";

function App() {
	return (
		<BrowserRouter>
			<div>
				<nav
					style={{
						position: "fixed",
						bottom: 0,
						left: 0,
						right: 0,
						background: "rgba(0,0,0,0.8)",
						padding: "10px 20px",
						zIndex: 1000,
						display: "flex",
						gap: "20px",
						overflow: "auto",
					}}
				>
					<Link
						to="/"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						Instanced Mesh
					</Link>
					<Link
						to="/conveyor-belt"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						Conveyor Belt
					</Link>
					<Link
						to="/editable-conveyor-belt"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						Editable Conveyor Belt
					</Link>
					<Link
						to="/gsap-animation"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						GSAP Animation
					</Link>
					<Link
						to="/path-animation"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						Path Animation
					</Link>
					<Link
						to="/physics-conveyor-belt"
						style={{
							color: "white",
							textDecoration: "none",
							padding: "5px 10px",
						}}
					>
						Physics Conveyor Belt
					</Link>
				</nav>

				<div style={{ paddingTop: "60px" }}>
					<Routes>
						<Route path="/" element={<AnimatedInstancesExample />} />
						<Route path="/conveyor-belt" element={<ConveyorBeltExample />} />
						<Route
							path="/editable-conveyor-belt"
							element={<EditableConveyorBeltExample />}
						/>
						<Route path="/gsap-animation" element={<GSAPAnimationExample />} />
						<Route path="/path-animation" element={<PathAnimationExample />} />
						<Route
							path="/physics-conveyor-belt"
							element={<PhysicsConveyorBeltExample />}
						/>
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
