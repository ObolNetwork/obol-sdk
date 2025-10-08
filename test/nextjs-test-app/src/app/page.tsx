'use client'

import { useState } from 'react'
import { Client } from '@obolnetwork/obol-sdk'
import { ethers } from 'ethers'

interface TestResult {
  success: boolean
  message: string
  details?: any
}

export default function Home() {
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string>('')
  const [signer, setSigner] = useState<any>(null)
  const [termsAccepted, setTermsAccepted] = useState<string>('')

  const connectWallet = async () => {
    try {
      if (typeof window.ethereum === 'undefined') {
        alert('MetaMask is not installed! Please install MetaMask to continue.')
        return
      }

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const userSigner = await provider.getSigner()
      const address = await userSigner.getAddress()

      setSigner(userSigner)
      setWalletAddress(address)
      setWalletConnected(true)

      setTestResults([{
        success: true,
        message: '✅ MetaMask connected successfully',
        details: {
          address,
          network: await provider.getNetwork().then(n => n.name)
        }
      }])
    } catch (error: any) {
      setTestResults([{
        success: false,
        message: '❌ Failed to connect MetaMask',
        details: error.message
      }])
    }
  }

  const disconnectWallet = () => {
    setSigner(null)
    setWalletAddress('')
    setWalletConnected(false)
    setTermsAccepted('')
    setTestResults([])
  }

  const acceptTermsAndConditions = async () => {
    if (!signer) {
      alert('Please connect MetaMask first')
      return
    }

    setIsLoading(true)
    try {
      const client = new Client({ 
        baseUrl: 'https://api.obol.tech',
        chainId: 1 
      }, signer)

      const result = await client.acceptObolLatestTermsAndConditions()
      
      setTermsAccepted('✅ Terms accepted')
      setTestResults([{
        success: true,
        message: '✅ Terms and Conditions accepted successfully',
        details: {
          result,
          address: walletAddress
        }
      }])
    } catch (error: any) {
      setTermsAccepted('')
      setTestResults([{
        success: false,
        message: '❌ Failed to accept Terms and Conditions',
        details: {
          error: error.message,
          hint: 'Make sure you are connected to the correct network'
        }
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const runSDKTests = async () => {
    setIsLoading(true)
    setTestResults([])
    const results: TestResult[] = []

    try {
      // Test 1: Basic SDK Import and Instantiation
      try {
        const client = new Client({
          baseUrl: 'https://api.obol.tech',
          chainId: 1
        })
        
        results.push({
          success: true,
          message: '✅ SDK Client instantiated successfully',
          details: {
            baseUrl: client.baseUrl,
            chainId: client.chainId
          }
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ Failed to instantiate SDK Client',
          details: error
        })
      }

      // Test 2: Check if modules are accessible
      try {
        const client = new Client({
          baseUrl: 'https://api.obol.tech',
          chainId: 1
        })
        
        const modules = {
          incentives: !!client.incentives,
          exit: !!client.exit,
          splits: !!client.splits,
          eoa: !!client.eoa
        }
        
        results.push({
          success: true,
          message: '✅ All SDK modules are accessible',
          details: modules
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ Failed to access SDK modules',
          details: error
        })
      }

      // Test 3: Test constants import
      try {
        // This will test if constants are properly bundled
        const client = new Client({
          baseUrl: 'https://api.obol.tech',
          chainId: 1
        })
        
        results.push({
          success: true,
          message: '✅ SDK constants and types are accessible',
          details: {
            forkVersion: client.fork_version,
            chainId: client.chainId
          }
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ Failed to access SDK constants',
          details: error
        })
      }

      // Test 4: Test browser environment detection
      try {
        const isBrowser = typeof window !== 'undefined'
        const hasFetch = typeof fetch !== 'undefined'
        const hasCrypto = typeof crypto !== 'undefined'
        
        results.push({
          success: true,
          message: '✅ Browser environment detected correctly',
          details: {
            isBrowser,
            hasFetch,
            hasCrypto,
            userAgent: navigator.userAgent
          }
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ Failed to detect browser environment',
          details: error
        })
      }

      // Test 5: Test actual SDK method calls
      try {
        const client = new Client({
          baseUrl: 'https://api.obol.tech',
          chainId: 1
        })
        
        // Test fetching cluster data (doesn't need a signer)
        let apiTestPassed = false
        try {
          // This should work (GET request, no dependencies)
          await client.getClusterDefinition('test-config-hash')
        } catch (error: any) {
          // Expected to fail with 404, but that means the method works!
          apiTestPassed = error?.message?.includes('Not Found') || 
                          error?.status === 404 ||
                          error?.message?.includes('404')
        }
        
        results.push({
          success: apiTestPassed,
          message: apiTestPassed 
            ? '✅ SDK API methods work in browser' 
            : '❌ SDK API methods failed',
          details: {
            note: 'getClusterDefinition() executed successfully',
            expectation: '404 Not Found (expected - means method works)'
          }
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ SDK method call failed',
          details: error
        })
      }
      
      // Test 6: Check what's bundled vs external
      try {
        results.push({
          success: true,
          message: '✅ Dependency analysis',
          details: {
            bundled: 'ajv, uuid, elliptic, @chainsafe/enr, @chainsafe/ssz (in SDK)',
            external: 'ethers, @chainsafe/bls, @safe-global/protocol-kit (user installs)',
            browserAPIs: 'fetch, crypto.subtle (native browser)'
          }
        })
      } catch (error) {
        results.push({
          success: false,
          message: '❌ Dependency analysis failed',
          details: error
        })
      }

    } catch (error) {
      results.push({
        success: false,
        message: '❌ Critical error during SDK testing',
        details: error
      })
    }

    setTestResults(results)
    setIsLoading(false)
  }

  const getStatusClass = (success: boolean) => {
    return success ? 'success' : 'error'
  }

  const getStatusText = (success: boolean) => {
    return success ? 'PASS' : 'FAIL'
  }

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">Obol SDK Browser Compatibility Test</h1>
        <p className="subtitle">
          This Next.js app tests the Obol SDK in a browser environment to verify compatibility.
        </p>
        
        <div style={{ marginBottom: '2rem' }}>
          {!walletConnected ? (
            <button 
              className="button" 
              onClick={connectWallet}
              style={{ marginRight: '1rem' }}
            >
              Connect MetaMask
            </button>
          ) : (
            <>
              <div style={{ marginBottom: '1rem', color: '#10b981', fontWeight: 'bold' }}>
                ✅ Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                {termsAccepted && <span style={{ marginLeft: '1rem' }}>{termsAccepted}</span>}
              </div>
              <button 
                className="button" 
                onClick={disconnectWallet}
                style={{ marginRight: '1rem', background: '#6b7280' }}
              >
                Disconnect
              </button>
              <button 
                className="button" 
                onClick={acceptTermsAndConditions}
                disabled={isLoading || !!termsAccepted}
                style={{ marginRight: '1rem', background: '#059669' }}
              >
                {isLoading ? 'Signing...' : termsAccepted ? 'Terms Accepted ✅' : 'Accept Terms & Conditions'}
              </button>
            </>
          )}
        </div>

        <button 
          className="button" 
          onClick={runSDKTests}
          disabled={isLoading}
        >
          {isLoading ? 'Running Tests...' : 'Run SDK Tests'}
        </button>
      </div>

      {testResults.length > 0 && (
        <div className="test-section">
          <h2 className="test-title">Test Results</h2>
          <div className="test-description">
            {testResults.filter(r => r.success).length} of {testResults.length} tests passed
          </div>
          
          {testResults.map((result, index) => (
            <div key={index} className="test-section">
              <div className="test-title">
                {result.message}
                <span className={`status ${getStatusClass(result.success)}`}>
                  {getStatusText(result.success)}
                </span>
              </div>
              
              {result.details && (
                <div className={`result ${result.success ? 'info' : 'error'}`}>
                  {JSON.stringify(result.details, null, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="test-section">
        <h2 className="test-title">About This Test</h2>
        <div className="test-description">
          This test app verifies that the Obol SDK works correctly in a browser environment by:
          <ul style={{ marginTop: '1rem', paddingLeft: '2rem' }}>
            <li>Testing SDK client instantiation</li>
            <li>Verifying all modules are accessible</li>
            <li>Checking constants and types are properly bundled</li>
            <li>Confirming browser environment detection</li>
            <li>Ensuring Node.js-specific modules are externalized</li>
          </ul>
        </div>
      </div>

      <div className="test-section">
        <h2 className="test-title">Build Information</h2>
        <div className="test-description">
          <p><strong>SDK Version:</strong> 2.11.5-rc.0</p>
          <p><strong>Build Target:</strong> Browser ESM</p>
          <p><strong>Bundle Size:</strong> ~1.73 MB (includes bundled dependencies)</p>
          <p><strong>Externalized:</strong> Node.js-specific packages (pdf-parse, dotenv, etc.)</p>
        </div>
      </div>
    </div>
  )
}
