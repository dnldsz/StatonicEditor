import React, { useState, useRef, useEffect } from 'react'
import { Account } from '../types'

interface AccountDropdownProps {
  accounts: Account[]
  currentAccountId: string | null
  onSelectAccount: (accountId: string) => void
}

export default function AccountDropdown({
  accounts,
  currentAccountId,
  onSelectAccount
}: AccountDropdownProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentAccount = accounts.find(a => a.id === currentAccountId)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="account-dropdown" ref={dropdownRef}>
      <button
        className="account-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch account"
      >
        {currentAccount ? (
          <>
            <div className="account-avatar-placeholder">
              {currentAccount.name.charAt(0).toUpperCase()}
            </div>
            <span className="account-name">{currentAccount.name}</span>
          </>
        ) : (
          <span>No Account</span>
        )}
        <span className="account-dropdown-arrow">▼</span>
      </button>

      {isOpen && (
        <div className="account-dropdown-menu">
          {accounts.map(account => (
            <button
              key={account.id}
              className={`account-dropdown-item ${account.id === currentAccountId ? 'active' : ''}`}
              onClick={() => {
                onSelectAccount(account.id)
                setIsOpen(false)
              }}
            >
              <div className="account-avatar-placeholder-small">
                {account.name.charAt(0).toUpperCase()}
              </div>
              <span>{account.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
