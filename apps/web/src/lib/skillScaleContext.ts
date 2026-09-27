import type { SkillScale } from '@q2dink/shared'
import { createContext, useContext } from 'react'
import { DEFAULT_SCALE } from '@/lib/skill'

/**
 * The skill levels the screen shows: the club's (App), or inside a session the session's own (SessionScreen), or on
 * the live page the one the snapshot carries (ViewerScreen).
 */
export const SkillScaleContext = createContext<SkillScale>(DEFAULT_SCALE)

export const useSkillScale = () => useContext(SkillScaleContext)
