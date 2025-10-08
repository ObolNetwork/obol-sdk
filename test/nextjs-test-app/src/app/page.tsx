'use client'

import { useState, useEffect } from 'react'

// Extend Window interface to include ethereum property from MetaMask
declare global {
  interface Window {
    ethereum?: any
  }
}

export default function Home() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<any>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    setMessage('Page mounted successfully ✅')
  }, [])

  const connectWallet = async () => {
    try {
      setError(null)
      setMessage('Checking for MetaMask...')

      if (!window.ethereum) {
        throw new Error('MetaMask is not installed! Please install MetaMask.')
      }

      setMessage('Requesting account access...')
      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const address = await signer.getAddress()

      setWalletAddress(address)
      setIsConnected(true)
      setMessage(`✅ Connected to ${address.slice(0, 6)}...${address.slice(-4)}`)
    } catch (err: any) {
      setError({ message: err.message, stack: err.stack })
      setMessage(`❌ Error: ${err.message}`)
    }
  }

  const testSDK = async () => {
    try {
      setError(null)
      setMessage('Loading SDK...')
      
      const { Client } = await import('@obolnetwork/obol-sdk')
      
      setMessage('Instantiating Client...')
      const client = new Client({
        baseUrl: 'https://api.obol.tech',
        chainId: 1
      })
      
      console.log('Client created:', client)
      setMessage(`✅ Success! SDK loaded and Client created. Chain: ${client.chainId}`)
    } catch (error: any) {
      const errorDetails = {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
      setError(errorDetails)
      setMessage(`❌ Error: ${error.message}`)
      console.error('Caught error:', errorDetails)
    }
  }

  const signTermsAndConditions = async () => {
    try {
      if (!isConnected) {
        throw new Error('Please connect MetaMask first')
      }

      setError(null)
      setMessage('Loading SDK and ethers...')
      
      const [{ Client }, { ethers }] = await Promise.all([
        import('@obolnetwork/obol-sdk'),
        import('ethers')
      ])

      setMessage('Getting signer...')
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()

      setMessage('Creating SDK Client...')
      const client = new Client({
        baseUrl: 'https://api.obol.tech',
        chainId: 1
      }, signer)

      setMessage('Signing Terms and Conditions...')
      const result = await client.acceptObolLatestTermsAndConditions()

      console.log('Terms signed:', result)
      setMessage(`✅ Terms and Conditions signed successfully!`)
    } catch (error: any) {
      const errorDetails = {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
      setError(errorDetails)
      setMessage(`❌ Error: ${error.message}`)
      console.error('Caught error:', errorDetails)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '1200px' }}>
      <h1>Obol SDK Next.js Test</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <button 
          onClick={connectWallet}
          disabled={isConnected}
          style={{
            padding: '1rem 2rem',
            fontSize: '16px',
            background: isConnected ? '#10b981' : '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isConnected ? 'default' : 'pointer',
            marginRight: '1rem',
            opacity: isConnected ? 0.7 : 1
          }}
        >
          {isConnected ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect MetaMask'}
        </button>

        <button 
          onClick={testSDK}
          style={{
            padding: '1rem 2rem',
            fontSize: '16px',
            background: '#8b5cf6',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            marginRight: '1rem'
          }}
        >
          Test SDK Import
        </button>

        <button 
          onClick={signTermsAndConditions}
          disabled={!isConnected}
          style={{
            padding: '1rem 2rem',
            fontSize: '16px',
            background: '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isConnected ? 'pointer' : 'not-allowed',
            opacity: isConnected ? 1 : 0.5
          }}
        >
          Sign Terms & Conditions
        </button>
      </div>

      {message && (
        <div style={{ 
          marginTop: '2rem', 
          padding: '1rem', 
          background: message.includes('✅') ? '#d4edda' : '#f8d7da',
          borderRadius: '5px',
          border: `1px solid ${message.includes('✅') ? '#c3e6cb' : '#f5c6cb'}`
        }}>
          <strong>Status:</strong> {message}
        </div>
      )}

      {error && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '1rem', 
          background: '#fff3cd',
          borderRadius: '5px',
          border: '1px solid #ffeeba'
        }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#856404' }}>Error Details:</h3>
          <p><strong>Name:</strong> {error.name}</p>
          <p><strong>Message:</strong> {error.message}</p>
          <details>
            <summary style={{ cursor: 'pointer', color: '#856404', marginTop: '0.5rem' }}>
              Stack Trace (click to expand)
            </summary>
            <pre style={{ 
              fontSize: '12px', 
              overflow: 'auto', 
              background: '#fff', 
              padding: '0.5rem',
              borderRadius: '3px',
              marginTop: '0.5rem'
            }}>
              {error.stack}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
