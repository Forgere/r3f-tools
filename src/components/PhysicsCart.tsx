import { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useControls } from "leva";

interface PhysicsCartProps {
  position?: [number, number, number];
  speed?: number;
  path?: THREE.Vector3[];
  onPathProgress?: (progress: number) => void;
}

export function PhysicsCart({ 
  position = [0, 0, 0], 
  speed = 1,
  path = [],
  onPathProgress
}: PhysicsCartProps) {
  const rigidBodyRef = useRef<any>(null);
  const cartRef = useRef<THREE.Group>(null);
  const pathProgress = useRef(0);
  
  const { cartWidth, cartHeight, cartLength, wheelRadius, wheelWidth } = useControls({
    cartWidth: { value: 0.8, min: 0.3, max: 2, step: 0.1 },
    cartHeight: { value: 0.3, min: 0.1, max: 1, step: 0.1 },
    cartLength: { value: 1.2, min: 0.5, max: 3, step: 0.1 },
    wheelRadius: { value: 0.15, min: 0.05, max: 0.5, step: 0.01 },
    wheelWidth: { value: 0.08, min: 0.03, max: 0.2, step: 0.01 },
  });

  // Create cart materials
  const cartMaterial = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: 0x2c3e50,
    roughness: 0.4,
    metalness: 0.6
  }), []);

  const wheelMaterial = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: 0x34495e,
    roughness: 0.6,
    metalness: 0.4
  }), []);

  // Calculate position along path
  useFrame((state, delta) => {
    if (path.length < 2 || !rigidBodyRef.current) return;

    // Update progress along path
    pathProgress.current += speed * delta * 0.1;
    if (pathProgress.current > 1) pathProgress.current = 0;

    // Get position on path
    const curve = new THREE.CatmullRomCurve3(path);
    const point = curve.getPointAt(pathProgress.current);
    
    // Get tangent for orientation
    const tangent = curve.getTangentAt(pathProgress.current);
    
    // Update rigid body position
    rigidBodyRef.current.setTranslation({ x: point.x, y: point.y + 0.5, z: point.z }, true);
    
    // Update rotation to follow path
    const lookAtPoint = point.clone().add(tangent);
    const quaternion = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    matrix.lookAt(point, lookAtPoint, new THREE.Vector3(0, 1, 0));
    quaternion.setFromRotationMatrix(matrix);
    rigidBodyRef.current.setRotation(quaternion, true);

    if (onPathProgress) {
      onPathProgress(pathProgress.current);
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      colliders="cuboid"
      restitution={0.3}
      friction={0.5}
      mass={10}
    >
      <group ref={cartRef}>
        {/* Main cart body */}
        <mesh position={[0, 0, 0]} material={cartMaterial}>
          <boxGeometry args={[cartLength, cartHeight, cartWidth]} />
        </mesh>
        
        {/* Cart floor */}
        <mesh position={[0, -cartHeight/2, 0]} material={cartMaterial}>
          <boxGeometry args={[cartLength, 0.05, cartWidth]} />
        </mesh>
        
        {/* Wheels */}
        {[-cartLength/2 + 0.2, cartLength/2 - 0.2].map((x) => 
          [-cartWidth/2 + 0.1, cartWidth/2 - 0.1].map((z) => (
            <group key={`wheel-${x}-${z}`} position={[x, -cartHeight/2 - wheelRadius, z]}>
              <mesh rotation={[0, 0, Math.PI/2]} material={wheelMaterial}>
                <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 16]} />
              </mesh>
              <mesh rotation={[0, 0, Math.PI/2]} material={wheelMaterial}>
                <cylinderGeometry args={[wheelRadius * 0.7, wheelRadius * 0.7, wheelWidth + 0.02, 8]} />
              </mesh>
            </group>
          ))
        )}
        
        {/* Side rails */}
        <mesh position={[0, cartHeight/2 + 0.05, cartWidth/2]} material={cartMaterial}>
          <boxGeometry args={[cartLength, 0.1, 0.05]} />
        </mesh>
        <mesh position={[0, cartHeight/2 + 0.05, -cartWidth/2]} material={cartMaterial}>
          <boxGeometry args={[cartLength, 0.1, 0.05]} />
        </mesh>
        
        {/* Front and back rails */}
        <mesh position={[cartLength/2, cartHeight/2 + 0.05, 0]} material={cartMaterial}>
          <boxGeometry args={[0.05, 0.1, cartWidth]} />
        </mesh>
        <mesh position={[-cartLength/2, cartHeight/2 + 0.05, 0]} material={cartMaterial}>
          <boxGeometry args={[0.05, 0.1, cartWidth]} />
        </mesh>
      </group>
    </RigidBody>
  );
}
