import { gsap } from 'gsap'
import type { Object3D } from 'three'

export interface AnimationConfig {
  position?: {
    x?: number
    y?: number
    z?: number
  }
  rotation?: {
    x?: number
    y?: number
    z?: number
  }
  duration?: number
  ease?: string
  delay?: number
  onComplete?: () => void
  onUpdate?: () => void
}

export interface AnimationPoint {
  x: number
  y: number
  z: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  duration?: number
}

export class GSAPAnimator {
  private object3D: Object3D
  private currentTimeline: gsap.core.Timeline | null = null
  private animationQueue: AnimationConfig[] = []
  private isAnimating = false
  private continuousMode = false
  private fetchPointsCallback: (() => Promise<AnimationPoint[]>) | null = null
  private continuousInterval: NodeJS.Timeout | null = null
  private tweens: Set<gsap.core.Tween> = new Set() // Track all tweens for proper cleanup
  private timelines: Set<gsap.core.Timeline> = new Set() // Track all timelines separately
  public isDestroyed = false // Flag to prevent operations after destruction

  constructor(object3D: Object3D) {
    this.object3D = object3D
  }

  animate(config: AnimationConfig): Promise<void> {
    if (this.isDestroyed) return Promise.resolve()
    
    return new Promise((resolve) => {
      const animationWithResolve = {
        ...config,
        onComplete: () => {
          config.onComplete?.()
          resolve()
        }
      }
      
      this.animationQueue.push(animationWithResolve)
      this.processQueue()
    })
  }

  animateSequence(configs: AnimationConfig[]): Promise<void> {
    if (this.isDestroyed) return Promise.resolve()
    
    return new Promise((resolve) => {
      const timeline = gsap.timeline({
        onComplete: () => {
          // Remove timeline from tracking when complete
          this.timelines.delete(timeline)
          if (this.currentTimeline === timeline) {
            this.currentTimeline = null
          }
          resolve()
        }
      })

      // Track timeline for cleanup
      this.timelines.add(timeline)

      // Track current position and rotation for continuous animation
      const currentState = {
        posX: this.object3D.position.x,
        posY: this.object3D.position.y,
        posZ: this.object3D.position.z,
        rotX: this.object3D.rotation.x,
        rotY: this.object3D.rotation.y,
        rotZ: this.object3D.rotation.z
      }

      configs.forEach((config) => {
        const duration = config.duration || 1
        const ease = config.ease || 'power2.inOut'

        // Create proxy objects for position and rotation
        const proxy: Record<string, number> = {}
        const hasPosition = config.position && Object.keys(config.position).length > 0
        const hasRotation = config.rotation && Object.keys(config.rotation).length > 0

        if (!hasPosition && !hasRotation) return

        // Set initial values from current state (not from object3D directly)
        if (hasPosition && config.position) {
          if (config.position.x !== undefined) {
            proxy.posX = currentState.posX
          }
          if (config.position.y !== undefined) {
            proxy.posY = currentState.posY
          }
          if (config.position.z !== undefined) {
            proxy.posZ = currentState.posZ
          }
        }

        if (hasRotation && config.rotation) {
          if (config.rotation.x !== undefined) {
            proxy.rotX = currentState.rotX
          }
          if (config.rotation.y !== undefined) {
            proxy.rotY = currentState.rotY
          }
          if (config.rotation.z !== undefined) {
            proxy.rotZ = currentState.rotZ
          }
        }

        // Create target values and update current state
        const targets: Record<string, number> = {}
        if (hasPosition && config.position) {
          if (config.position.x !== undefined) {
            targets.posX = config.position.x
            currentState.posX = config.position.x
          }
          if (config.position.y !== undefined) {
            targets.posY = config.position.y
            currentState.posY = config.position.y
          }
          if (config.position.z !== undefined) {
            targets.posZ = config.position.z
            currentState.posZ = config.position.z
          }
        }

        if (hasRotation && config.rotation) {
          if (config.rotation.x !== undefined) {
            targets.rotX = config.rotation.x
            currentState.rotX = config.rotation.x
          }
          if (config.rotation.y !== undefined) {
            targets.rotY = config.rotation.y
            currentState.rotY = config.rotation.y
          }
          if (config.rotation.z !== undefined) {
            targets.rotZ = config.rotation.z
            currentState.rotZ = config.rotation.z
          }
        }

        if (Object.keys(targets).length > 0) {
          timeline.to(proxy, {
            ...targets,
            duration,
            ease,
            delay: config.delay || 0,
            onUpdate: () => {
              // Check if destroyed during animation
              if (this.isDestroyed) return
              
              // Update actual object3D properties
              if (hasPosition && config.position) {
                if (config.position.x !== undefined && 'posX' in proxy) {
                  this.object3D.position.x = proxy.posX
                }
                if (config.position.y !== undefined && 'posY' in proxy) {
                  this.object3D.position.y = proxy.posY
                }
                if (config.position.z !== undefined && 'posZ' in proxy) {
                  this.object3D.position.z = proxy.posZ
                }
              }

              if (hasRotation && config.rotation) {
                if (config.rotation.x !== undefined && 'rotX' in proxy) {
                  this.object3D.rotation.x = proxy.rotX
                }
                if (config.rotation.y !== undefined && 'rotY' in proxy) {
                  this.object3D.rotation.y = proxy.rotY
                }
                if (config.rotation.z !== undefined && 'rotZ' in proxy) {
                  this.object3D.rotation.z = proxy.rotZ
                }
              }

              config.onUpdate?.()
            },
            onComplete: config.onComplete
          })
        }
      })

      this.currentTimeline = timeline
    })
  }

  private processQueue(): void {
    if (this.isDestroyed || this.isAnimating || this.animationQueue.length === 0) return

    this.isAnimating = true
    const config = this.animationQueue.shift()
    if (!config) {
      this.isAnimating = false
      return
    }
    
    this.executeAnimation(config).then(() => {
      this.isAnimating = false
      if (!this.isDestroyed) {
        this.processQueue()
      }
    }).catch(() => {
      this.isAnimating = false
    })
  }

  private executeAnimation(config: AnimationConfig): Promise<void> {
    if (this.isDestroyed) return Promise.resolve()
    
    return new Promise((resolve) => {
      const duration = config.duration || 1
      const ease = config.ease || 'power2.inOut'

      // Create proxy objects for position and rotation
      const proxy: Record<string, number> = {}
      const hasPosition = config.position && Object.keys(config.position).length > 0
      const hasRotation = config.rotation && Object.keys(config.rotation).length > 0

      if (!hasPosition && !hasRotation) {
        resolve()
        return
      }

      // Set initial values and target values
      if (hasPosition && config.position) {
        if (config.position.x !== undefined) {
          proxy.posX = this.object3D.position.x
        }
        if (config.position.y !== undefined) {
          proxy.posY = this.object3D.position.y
        }
        if (config.position.z !== undefined) {
          proxy.posZ = this.object3D.position.z
        }
      }

      if (hasRotation && config.rotation) {
        if (config.rotation.x !== undefined) {
          proxy.rotX = this.object3D.rotation.x
        }
        if (config.rotation.y !== undefined) {
          proxy.rotY = this.object3D.rotation.y
        }
        if (config.rotation.z !== undefined) {
          proxy.rotZ = this.object3D.rotation.z
        }
      }

      // Create target values
      const targets: Record<string, number> = {}
      if (hasPosition && config.position) {
        if (config.position.x !== undefined) targets.posX = config.position.x
        if (config.position.y !== undefined) targets.posY = config.position.y
        if (config.position.z !== undefined) targets.posZ = config.position.z
      }

      if (hasRotation && config.rotation) {
        if (config.rotation.x !== undefined) targets.rotX = config.rotation.x
        if (config.rotation.y !== undefined) targets.rotY = config.rotation.y
        if (config.rotation.z !== undefined) targets.rotZ = config.rotation.z
      }

      const tween = gsap.to(proxy, {
        ...targets,
        duration,
        ease,
        delay: config.delay || 0,
        onUpdate: () => {
          // Check if destroyed during animation
          if (this.isDestroyed) return
          
          // Update actual object3D properties
          if (hasPosition && config.position) {
            if (config.position.x !== undefined && 'posX' in proxy) {
              this.object3D.position.x = proxy.posX
            }
            if (config.position.y !== undefined && 'posY' in proxy) {
              this.object3D.position.y = proxy.posY
            }
            if (config.position.z !== undefined && 'posZ' in proxy) {
              this.object3D.position.z = proxy.posZ
            }
          }

          if (hasRotation && config.rotation) {
            if (config.rotation.x !== undefined && 'rotX' in proxy) {
              this.object3D.rotation.x = proxy.rotX
            }
            if (config.rotation.y !== undefined && 'rotY' in proxy) {
              this.object3D.rotation.y = proxy.rotY
            }
            if (config.rotation.z !== undefined && 'rotZ' in proxy) {
              this.object3D.rotation.z = proxy.rotZ
            }
          }

          config.onUpdate?.()
        },
        onComplete: () => {
          // Remove tween from tracking
          this.tweens.delete(tween)
          config.onComplete?.()
          resolve()
        }
      })

      // Track tween for cleanup
      this.tweens.add(tween)
      this.currentTimeline = gsap.timeline().add(tween)
    })
  }

  kill(): void {
    // Kill current timeline
    if (this.currentTimeline) {
      this.currentTimeline.kill()
      this.currentTimeline = null
    }
    
    // Kill all tracked timelines
    this.timelines.forEach(timeline => {
      timeline?.kill()
    })
    this.timelines.clear()
    
    // Kill all tracked tweens
    this.tweens.forEach(tween => {
      tween?.kill()
    })
    this.tweens.clear()
    
    // Clear animation queue
    this.animationQueue.length = 0
    this.isAnimating = false
  }

  // Complete cleanup and destroy the animator
  destroy(): void {
    this.isDestroyed = true
    
    // Stop continuous animation
    this.stopContinuousAnimation()
    
    // Kill all animations
    this.kill()
    
    // Clear all references to prevent memory leaks
    this.fetchPointsCallback = null
    this.animationQueue = []
    this.tweens.clear()
    this.timelines.clear()
  }

  pause(): void {
    if (this.currentTimeline && !this.isDestroyed) {
      this.currentTimeline.pause()
    }
  }

  resume(): void {
    if (this.currentTimeline && !this.isDestroyed) {
      this.currentTimeline.resume()
    }
  }

  isPlaying(): boolean {
    return !this.isDestroyed && this.currentTimeline ? this.currentTimeline.isActive() : false
  }

  // 启动持续动画模式
  startContinuousAnimation(
    fetchPointsCallback: () => Promise<AnimationPoint[]>,
    intervalMs: number = 2000
  ): void {
    if (this.isDestroyed) return
    
    this.fetchPointsCallback = fetchPointsCallback
    this.continuousMode = true
    
    const fetchAndAnimate = async () => {
      if (!this.continuousMode || !this.fetchPointsCallback || this.isDestroyed) return
      
      try {
        const points = await this.fetchPointsCallback()
        if (points.length > 0 && !this.isDestroyed) {
          // 将新点转换为动画配置并添加到队列
          points.forEach(point => {
            const config: AnimationConfig = {
              position: { x: point.x, y: point.y, z: point.z },
              rotation: point.rotationX !== undefined || point.rotationY !== undefined || point.rotationZ !== undefined 
                ? {
                    x: point.rotationX,
                    y: point.rotationY, 
                    z: point.rotationZ
                  } 
                : undefined,
              duration: point.duration || 1,
              ease: 'power2.inOut'
            }
            this.animationQueue.push(config)
          })
          
          // 如果当前没有动画在运行，开始处理队列
          if (!this.isAnimating && !this.isDestroyed) {
            this.processQueue()
          }
        }
      } catch (error) {
        console.error('Failed to fetch animation points:', error)
      }
      
      // 设置下一次获取
      if (this.continuousMode && !this.isDestroyed) {
        this.continuousInterval = setTimeout(fetchAndAnimate, intervalMs)
      }
    }
    
    // 立即开始第一次获取
    fetchAndAnimate()
  }

  // 停止持续动画模式
  stopContinuousAnimation(): void {
    this.continuousMode = false
    this.fetchPointsCallback = null
    
    if (this.continuousInterval) {
      clearTimeout(this.continuousInterval)
      this.continuousInterval = null
    }
  }

  // 直接添加动画点到队列
  addAnimationPoint(point: AnimationPoint): void {
    if (this.isDestroyed) return
    
    const config: AnimationConfig = {
      position: { x: point.x, y: point.y, z: point.z },
      rotation: point.rotationX !== undefined || point.rotationY !== undefined || point.rotationZ !== undefined 
        ? {
            x: point.rotationX,
            y: point.rotationY, 
            z: point.rotationZ
          } 
        : undefined,
      duration: point.duration || 1,
      ease: 'power2.inOut'
    }
    
    this.animationQueue.push(config)
    
    // 如果当前没有动画在运行，开始处理队列
    if (!this.isAnimating && !this.isDestroyed) {
      this.processQueue()
    }
  }

  // 批量添加动画点
  addAnimationPoints(points: AnimationPoint[]): void {
    if (this.isDestroyed) return
    
    points.forEach(point => this.addAnimationPoint(point))
  }

  // Get current queue size for monitoring
  getQueueSize(): number {
    return this.animationQueue.length
  }

  // Get number of active tweens for monitoring
  getActiveTweensCount(): number {
    return this.tweens.size
  }

  // Get number of active timelines for monitoring
  getActiveTimelinesCount(): number {
    return this.timelines.size
  }
}

export function createAnimator(object3D: Object3D): GSAPAnimator {
  return new GSAPAnimator(object3D)
}

export function animateObject(
  object3D: Object3D,
  config: AnimationConfig
): Promise<void> {
  const animator = new GSAPAnimator(object3D)
  return animator.animate(config)
}