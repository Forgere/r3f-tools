import { useRef, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";

interface PhysicsCarProps {
  position?: [number, number, number];
  mass?: number;
}

export function PhysicsCar({ 
  position = [0, 3, 0], 
  mass = 1000
}: PhysicsCarProps) {
  const rigidBodyRef = useRef<any>(null);
  const carRef = useRef<THREE.Group>(null);
  
  // Car physics properties
  const carProperties = useMemo(() => ({
    maxEngineForce: 3000,
    maxBrakeForce: 5000,
    maxSteeringAngle: Math.PI / 4, // 45 degrees
    steeringSpeed: 3.0,
    wheelBase: 1.0,
    trackWidth: 1.0,
    friction: 2.0, // Increased friction
    rollingFriction: 0.3, // Increased rolling friction
    maxSpeed: 30,
    downForce: 300, // Additional downward force for better grip
  }), []);

  // Car state
  const carState = useRef({
    speed: 0,
    steeringAngle: 0,
    engineForce: 0,
    brakeForce: 0,
    lastPosition: new THREE.Vector3(),
  });

  // Keyboard state
  const [keys, setKeys] = useState({
    w: false,
    a: false,
    s: false,
    d: false,
  });

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key in keys) {
        setKeys(prev => ({ ...prev, [key]: true }));
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key in keys) {
        setKeys(prev => ({ ...prev, [key]: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [keys]);

  // Create car materials
  const carMaterial = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: 0x2c3e50,
    roughness: 0.4,
    metalness: 0.6
  }), []);

  const wheelMaterial = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: 0x34495e,
    roughness: 0.6,
    metalness: 0.4
  }), []);

  // Apply car physics
  useFrame((state, delta) => {
    if (!rigidBodyRef.current) return;

    // Reset forces each frame
    carState.current.engineForce = 0;
    carState.current.brakeForce = 0;
    
    // Handle acceleration/braking
    if (keys.w) {
      // Forward acceleration
      carState.current.engineForce = carProperties.maxEngineForce;
    } 
    if (keys.s) {
      // Brake/reverse
      carState.current.brakeForce = carProperties.maxBrakeForce;
    }

    // Handle steering
    if (keys.a) {
      // Steer left
      carState.current.steeringAngle = Math.min(
        carState.current.steeringAngle + carProperties.steeringSpeed * delta,
        carProperties.maxSteeringAngle
      );
    } else if (keys.d) {
      // Steer right
      carState.current.steeringAngle = Math.max(
        carState.current.steeringAngle - carProperties.steeringSpeed * delta,
        -carProperties.maxSteeringAngle
      );
    } else {
      // Center steering wheel with faster return
      if (carState.current.steeringAngle > 0) {
        carState.current.steeringAngle = Math.max(
          carState.current.steeringAngle - carProperties.steeringSpeed * delta * 2,
          0
        );
      } else if (carState.current.steeringAngle < 0) {
        carState.current.steeringAngle = Math.min(
          carState.current.steeringAngle + carProperties.steeringSpeed * delta * 2,
          0
        );
      }
    }

    // Get current velocity and position
    const linvel = rigidBodyRef.current.linvel();
    const currentSpeed = linvel.length();
    const currentPosition = rigidBodyRef.current.translation();
    
    // Calculate speed based on position change
    const positionDelta = new THREE.Vector3().subVectors(
      currentPosition,
      carState.current.lastPosition
    );
    carState.current.speed = positionDelta.length() / delta;
    carState.current.lastPosition.copy(currentPosition);
    
    // Apply engine force in forward direction
    if (carState.current.engineForce > 0 && currentSpeed < carProperties.maxSpeed) {
      const forward = new THREE.Vector3(0, 0, 1);
      const force = forward.multiplyScalar(carState.current.engineForce);
      rigidBodyRef.current.applyImpulse(
        { x: force.x, y: 0, z: force.z },
        true
      );
    }
    
    // Apply braking force
    if (carState.current.brakeForce > 0) {
      if (currentSpeed > 0.1) {
        const brakeDirection = linvel.clone().normalize().multiplyScalar(-1);
        const brakeForce = brakeDirection.multiplyScalar(carState.current.brakeForce);
        rigidBodyRef.current.applyImpulse(
          { x: brakeForce.x, y: 0, z: brakeForce.z },
          true
        );
      }
    }
    
    // Apply rolling resistance (friction that slows the car naturally)
    if (currentSpeed > 0.1) {
      const resistanceDirection = linvel.clone().normalize().multiplyScalar(-1);
      const resistanceForce = resistanceDirection.multiplyScalar(
        carProperties.rollingFriction * currentSpeed * 150 // Increased resistance
      );
      rigidBodyRef.current.applyImpulse(
        { x: resistanceForce.x, y: 0, z: resistanceForce.z },
        true
      );
    }
    
    // Apply downforce for better grip
    rigidBodyRef.current.applyImpulse(
      { x: 0, y: -carProperties.downForce, z: 0 },
      true
    );
    
    // Apply steering by applying lateral forces at front wheels
    if (Math.abs(carState.current.steeringAngle) > 0.01 && currentSpeed > 0.5) {
      // Calculate lateral direction
      const right = new THREE.Vector3(-1, 0, 0);
      
      // Apply lateral force based on steering angle and speed
      const lateralForceMagnitude = carState.current.steeringAngle * currentSpeed * 1000; // Increased force
      const lateralForce = right.multiplyScalar(lateralForceMagnitude);
      
      // Apply force at front of car for steering effect
      rigidBodyRef.current.applyImpulse(
        { x: lateralForce.x, y: 0, z: lateralForce.z },
        { x: 0, y: 0, z: 0.3 } // Front of car
      );
    }

    // Update wheel rotations for visual effect
    if (carRef.current) {
      const frontWheels = carRef.current.children.filter(child => 
        child.name === "front-left-wheel" || 
        child.name === "front-right-wheel"
      );
      
      frontWheels.forEach(wheel => {
        // Apply steering rotation to front wheels
        wheel.rotation.y = carState.current.steeringAngle;
        
        // Apply rotation based on speed
        wheel.rotation.x += carState.current.speed * delta * 5;
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      colliders="cuboid"
      restitution={0.05} // Reduced bounciness
      friction={carProperties.friction}
      mass={mass}
      linearDamping={0.15} // Slightly increased damping
      angularDamping={0.95}
      enabledRotations={[false, false, false]} // Lock rotations to keep car upright
    >
      <group ref={carRef}>
        {/* Main car body */}
        <mesh position={[0, 0.25, 0]} material={carMaterial}>
          <boxGeometry args={[1.2, 0.3, 0.8]} />
        </mesh>
        
        {/* Car top */}
        <mesh position={[0, 0.5, 0]} material={carMaterial}>
          <boxGeometry args={[0.8, 0.2, 0.6]} />
        </mesh>
        
        {/* Wheels with names for easier selection */}
        <group name="front-left-wheel" position={[-0.5, 0, 0.3]}>
          <mesh rotation={[Math.PI/2, 0, 0]} material={wheelMaterial}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
          </mesh>
        </group>
        <group name="front-right-wheel" position={[0.5, 0, 0.3]}>
          <mesh rotation={[Math.PI/2, 0, 0]} material={wheelMaterial}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
          </mesh>
        </group>
        <group name="rear-left-wheel" position={[-0.5, 0, -0.3]}>
          <mesh rotation={[Math.PI/2, 0, 0]} material={wheelMaterial}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
          </mesh>
        </group>
        <group name="rear-right-wheel" position={[0.5, 0, -0.3]}>
          <mesh rotation={[Math.PI/2, 0, 0]} material={wheelMaterial}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
          </mesh>
        </group>
      </group>
    </RigidBody>
  );
}
