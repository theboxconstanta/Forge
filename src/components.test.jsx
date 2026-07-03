import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { AvatarCircle, LevelDot } from './components'
import { NIVEL_DOT_COLORS } from './utils'

afterEach(() => {
  cleanup()
})

describe('AvatarCircle', () => {
  it('afișează inițialele când nu are avatarUrl', () => {
    render(<AvatarCircle name="Lucian Rosca" />)
    expect(screen.getByText('LR')).toBeInTheDocument()
  })

  it('afișează ?? când nu are nume', () => {
    render(<AvatarCircle name={null} />)
    expect(screen.getByText('??')).toBeInTheDocument()
  })

  it('afișează o imagine cand are avatarUrl, nu inițialele', () => {
    render(<AvatarCircle name="Lucian Rosca" avatarUrl="https://example.com/avatar.jpg" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    expect(screen.queryByText('LR')).not.toBeInTheDocument()
  })

  it('folosește numele ca alt text al imaginii', () => {
    render(<AvatarCircle name="Lucian Rosca" avatarUrl="https://example.com/avatar.jpg" />)
    expect(screen.getByAltText('Lucian Rosca')).toBeInTheDocument()
  })

  it('respectă dimensiunea (size) primită', () => {
    render(<AvatarCircle name="Lucian Rosca" size={64} />)
    expect(screen.getByText('LR')).toHaveStyle({ width: '64px', height: '64px' })
  })
})

describe('LevelDot', () => {
  it.each([
    ['RX', NIVEL_DOT_COLORS.RX],
    ['Intermediate', NIVEL_DOT_COLORS.Intermediate],
    ['Beginner', NIVEL_DOT_COLORS.Beginner],
    ['OnRamp', NIVEL_DOT_COLORS.OnRamp],
  ])('folosește culoarea corectă pentru nivelul %s', (nivel, culoare) => {
    const { container } = render(<LevelDot nivel={nivel} />)
    expect(container.firstChild).toHaveStyle({ backgroundColor: culoare })
  })

  it('folosește o culoare gri pentru un nivel necunoscut', () => {
    const { container } = render(<LevelDot nivel="Necunoscut" />)
    expect(container.firstChild).toHaveStyle({ backgroundColor: '#ccc' })
  })

  it('respectă dimensiunea (size) primită', () => {
    const { container } = render(<LevelDot nivel="RX" size={20} />)
    expect(container.firstChild).toHaveStyle({ width: '20px', height: '20px' })
  })
})
