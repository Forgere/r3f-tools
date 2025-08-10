import { useRef, useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";

interface PhysicsConveyorBeltProps {
  curvePath: THREE.Vector3[];
  rollerSpacing?: number;
  frameWidth?: number;
  frameHeight?: number;
  frameDepth?: number;
  rollerRadius?: number;
  rollerLength?: number;
  segments?: number;
  showPath?: boolean;
  frameMaterial?: THREE.Material;
  rollerMaterial?: THREE.Material;
}

export function PhysicsConveyorBelt({
  curvePath,
  rollerSpacing = 0.8,
  frameWidth = 2.0,
  frameHeight = 0.5,
  frameDepth = 0.3,
  rollerRadius = 0.08,
  rollerLength = 2.2,
  segments = 16,
  showPath = false,
  frameMaterial,
  rollerMaterial,
}: PhysicsConveyorBeltProps) {
  const pathRef = useRef<THREE.Group>(null);

  // Create default materials if not provided
  const defaultFrameMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x282828,
        roughness: 0.6,
        metalness: 0.4,
      }),
    [],
  );

  const defaultRollerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x777777,
        roughness: 0.4,
        metalness: 0.6,
      }),
    [],
  );

  const finalFrameMaterial = frameMaterial || defaultFrameMaterial;
  const finalRollerMaterial = rollerMaterial || defaultRollerMaterial;

  // Create curve from points
  const curve = useMemo(() => {
    if (curvePath.length < 2) return null;
    return new THREE.CatmullRomCurve3(curvePath);
  }, [curvePath]);

  // Calculate frame positions and orientations
  const frameData = useMemo(() => {
    if (!curve) return [];

    const data = [];
    const totalLength = curve.getLength();
    const numFrames = Math.ceil(totalLength / rollerSpacing) + 1;

    for (let i = 0; i < numFrames; i++) {
      const t = i / (numFrames - 1);
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      
      // Create rotation matrix to align with tangent
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const actualUp = new THREE.Vector3().crossVectors(right, tangent).normalize();
      
      const matrix = new THREE.Matrix4();
      matrix.makeBasis(right, actualUp, tangent);
      
      data.push({ position: point, rotation: new THREE.Quaternion().setFromRotationMatrix(matrix) });
    }

    return data;
  }, [curve, rollerSpacing]);

  // Calculate roller positions
  const rollerData = useMemo(() => {
    if (!curve) return [];

    const data = [];
    const totalLength = curve.getLength();
    const numRollers = Math.ceil(totalLength / rollerSpacing) + 1;

    for (let i = 0; i < numRollers; i++) {
      const t = i / (numRollers - 1);
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      
      // Create rotation matrix to align roller with tangent
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      
      const matrix = new THREE.Matrix4();
      matrix.makeBasis(right, up, tangent);
      
      data.push({ position: point, rotation: new THREE.Quaternion().setFromRotationMatrix(matrix) });
    }

    return data;
  }, [curve, rollerSpacing]);

  if (!curve) return null;

  return (
    <group ref={pathRef}>
      {/* Frame segments */}
      {frameData.map((frame, index) => (
        <RigidBody
          key={`frame-${index.toString()}`}
          type="fixed"
          position={[frame.position.x, frame.position.y - frameHeight / 2, frame.position.z]}
          quaternion={[frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w]}
        >
          <CuboidCollider args={[frameDepth / 2, frameHeight / 2, frameWidth / 2]} />
          <mesh material={finalFrameMaterial}>
            <boxGeometry args={[frameDepth, frameHeight, frameWidth]} />
          </mesh>
        </RigidBody>
      ))}

      {/* Rollers */}
      {rollerData.map((roller, index) => (
        <RigidBody
          key={`roller-${index.toString()}`}
          type="fixed"
          position={[roller.position.x, roller.position.y - rollerRadius, roller.position.z]}
          quaternion={[roller.rotation.x, roller.rotation.y, roller.rotation.z, roller.rotation.w]}
        >
          <CuboidCollider args={[rollerLength / 2, rollerRadius, rollerRadius]} />
          <mesh material={finalRollerMaterial}>
            <cylinderGeometry args={[rollerRadius, rollerRadius, rollerLength, segments]} />
          </mesh>
        </RigidBody>
      ))}

      {/* Path visualization */}
      {showPath && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              // biome-ignore lint/suspicious/noExplicitAny: <i expected>
              args={[] as any}
              attach="attributes-position"
              count={curvePath.length}
              array={new Float32Array(curvePath.flatMap(p => [p.x, p.y, p.z]))}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={0xff0000} />
        </line>
      )}
    </group>
  );
}
