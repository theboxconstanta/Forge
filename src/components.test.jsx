import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach } from 'vitest'
import { AvatarCircle, LevelDot, Modal, MembershipCoverageDialog } from './components'
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

describe('Modal', () => {
  it('randeaza titlul si continutul cu rolul/atributele ARIA corecte', () => {
    render(<Modal title="Titlu test" onClose={() => {}}><p>Continut</p></Modal>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    expect(screen.getByText('Titlu test')).toBeInTheDocument()
    expect(screen.getByText('Continut')).toBeInTheDocument()
  })

  it('apeleaza onClose la apasarea tastei Escape', () => {
    const onClose = vi.fn()
    render(<Modal title="Titlu test" onClose={onClose}><p>Continut</p></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('apeleaza onClose la click pe fundal, dar nu la click in interiorul cardului', () => {
    const onClose = vi.fn()
    render(<Modal title="Titlu test" onClose={onClose}><p>Continut</p></Modal>)
    fireEvent.click(screen.getByText('Continut'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('muta focusul pe primul element focusabil la montare', () => {
    render(
      <Modal title="Titlu test" onClose={() => {}}>
        <button>Primul buton</button>
        <button>Al doilea buton</button>
      </Modal>,
    )
    expect(screen.getByRole('button', { name: 'Primul buton' })).toHaveFocus()
  })
})

const membershipCoverageT = {
  membershipCoverageDialogTitle: 'Abonamentul tău nu acoperă această dată',
  membershipCoverageDialogBody1: 'Clasa pe care încerci să o rezervi are loc după expirarea abonamentului tău.',
  membershipCoverageDialogBody2: 'Vei putea rezerva această clasă după ce îți prelungești abonamentul pentru perioada respectivă.',
  membershipCoverageDialogButton: 'Am înțeles',
}

describe('MembershipCoverageDialog', () => {
  it('afiseaza exact titlul si corpul textului cerut, prin infrastructura de traduceri existenta', () => {
    render(<MembershipCoverageDialog t={membershipCoverageT} onClose={() => {}} />)
    expect(screen.getByText('Abonamentul tău nu acoperă această dată')).toBeInTheDocument()
    expect(screen.getByText('Clasa pe care încerci să o rezervi are loc după expirarea abonamentului tău.')).toBeInTheDocument()
    expect(screen.getByText('Vei putea rezerva această clasă după ce îți prelungești abonamentul pentru perioada respectivă.')).toBeInTheDocument()
  })

  it('afiseaza un singur buton, fara actiune de reinnoire', () => {
    render(<MembershipCoverageDialog t={membershipCoverageT} onClose={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('apeleaza onClose la click pe singurul buton', () => {
    const onClose = vi.fn()
    render(<MembershipCoverageDialog t={membershipCoverageT} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Am înțeles' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('apeleaza onClose la Escape (mostenit din Modal)', () => {
    const onClose = vi.fn()
    render(<MembershipCoverageDialog t={membershipCoverageT} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
