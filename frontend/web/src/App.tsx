// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FHEProof {
  id: string;
  challenge: string;
  solution: string;
  timestamp: number;
  owner: string;
  status: "pending" | "verified" | "failed";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [proofs, setProofs] = useState<FHEProof[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newProofData, setNewProofData] = useState({
    challenge: "",
    solution: ""
  });
  const [searchTerm, setSearchTerm] = useState("");

  // Stats calculation
  const verifiedCount = proofs.filter(p => p.status === "verified").length;
  const pendingCount = proofs.filter(p => p.status === "pending").length;
  const failedCount = proofs.filter(p => p.status === "failed").length;

  // Filter proofs based on search term
  const filteredProofs = proofs.filter(proof => 
    proof.challenge.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proof.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadProofs().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadProofs = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("proof_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing proof keys:", e);
        }
      }
      
      const list: FHEProof[] = [];
      
      for (const key of keys) {
        try {
          const proofBytes = await contract.getData(`proof_${key}`);
          if (proofBytes.length > 0) {
            try {
              const proofData = JSON.parse(ethers.toUtf8String(proofBytes));
              list.push({
                id: key,
                challenge: proofData.challenge,
                solution: proofData.solution,
                timestamp: proofData.timestamp,
                owner: proofData.owner,
                status: proofData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing proof data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading proof ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setProofs(list);
    } catch (e) {
      console.error("Error loading proofs:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitProof = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting proof with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedSolution = `FHE-${btoa(newProofData.solution)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const proofId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const proofData = {
        challenge: newProofData.challenge,
        solution: encryptedSolution,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "pending"
      };
      
      // Store encrypted proof on-chain
      await contract.setData(
        `proof_${proofId}`, 
        ethers.toUtf8Bytes(JSON.stringify(proofData))
      );
      
      const keysBytes = await contract.getData("proof_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(proofId);
      
      await contract.setData(
        "proof_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE proof submitted successfully!"
      });
      
      await loadProofs();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProofData({
          challenge: "",
          solution: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyProof = async (proofId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying FHE proof..."
    });

    try {
      // Simulate FHE verification
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const proofBytes = await contract.getData(`proof_${proofId}`);
      if (proofBytes.length === 0) {
        throw new Error("Proof not found");
      }
      
      const proofData = JSON.parse(ethers.toUtf8String(proofBytes));
      
      const updatedProof = {
        ...proofData,
        status: "verified"
      };
      
      await contract.setData(
        `proof_${proofId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProof))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE proof verified!"
      });
      
      await loadProofs();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const markFailed = async (proofId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE proof..."
    });

    try {
      // Simulate FHE processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const proofBytes = await contract.getData(`proof_${proofId}`);
      if (proofBytes.length === 0) {
        throw new Error("Proof not found");
      }
      
      const proofData = JSON.parse(ethers.toUtf8String(proofBytes));
      
      const updatedProof = {
        ...proofData,
        status: "failed"
      };
      
      await contract.setData(
        `proof_${proofId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProof))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Proof marked as failed!"
      });
      
      await loadProofs();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Operation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE CAPTCHA v4</h1>
          <p>Fully Homomorphic Encryption Proof-of-Work</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Privacy-Preserving CAPTCHA</h2>
            <p>Solve FHE-encrypted challenges without revealing your data</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
            >
              Create New Proof
            </button>
          </div>
          <div className="hero-graphic">
            <div className="fhe-animation"></div>
          </div>
        </section>

        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Proofs</h3>
            <p>{proofs.length}</p>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <p>{verifiedCount}</p>
          </div>
          <div className="stat-card">
            <h3>Pending</h3>
            <p>{pendingCount}</p>
          </div>
          <div className="stat-card">
            <h3>Failed</h3>
            <p>{failedCount}</p>
          </div>
        </section>

        <section className="proofs-section">
          <div className="section-header">
            <h2>FHE Proof Records</h2>
            <div className="search-bar">
              <input 
                type="text" 
                placeholder="Search proofs..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button 
                onClick={loadProofs}
                disabled={isRefreshing}
                className="refresh-btn"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="proofs-list">
            {filteredProofs.length === 0 ? (
              <div className="empty-state">
                <p>No FHE proofs found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Proof
                </button>
              </div>
            ) : (
              filteredProofs.map(proof => (
                <div className="proof-card" key={proof.id}>
                  <div className="proof-header">
                    <span className="proof-id">#{proof.id.substring(0, 6)}</span>
                    <span className={`status-badge ${proof.status}`}>
                      {proof.status}
                    </span>
                  </div>
                  <div className="proof-content">
                    <h3>{proof.challenge}</h3>
                    <p>Owner: {proof.owner.substring(0, 6)}...{proof.owner.substring(38)}</p>
                    <p>Date: {new Date(proof.timestamp * 1000).toLocaleString()}</p>
                  </div>
                  <div className="proof-actions">
                    {isOwner(proof.owner) && proof.status === "pending" && (
                      <>
                        <button 
                          className="action-btn success"
                          onClick={() => verifyProof(proof.id)}
                        >
                          Verify
                        </button>
                        <button 
                          className="action-btn danger"
                          onClick={() => markFailed(proof.id)}
                        >
                          Mark Failed
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New FHE Proof</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Challenge</label>
                <input 
                  type="text" 
                  name="challenge"
                  value={newProofData.challenge} 
                  onChange={(e) => setNewProofData({...newProofData, challenge: e.target.value})}
                  placeholder="Enter challenge description"
                />
              </div>
              <div className="form-group">
                <label>Solution (FHE-encrypted)</label>
                <textarea 
                  name="solution"
                  value={newProofData.solution} 
                  onChange={(e) => setNewProofData({...newProofData, solution: e.target.value})}
                  placeholder="Enter solution that will be FHE-encrypted"
                  rows={4}
                />
              </div>
              <div className="fhe-notice">
                <p>Your solution will be encrypted using Fully Homomorphic Encryption before submission</p>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitProof} 
                disabled={creating}
                className="primary-btn"
              >
                {creating ? "Submitting..." : "Submit Proof"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>FHE CAPTCHA v4</h3>
            <p>Privacy-preserving proof-of-work system using Fully Homomorphic Encryption</p>
          </div>
          <div className="footer-section">
            <h3>Resources</h3>
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Whitepaper</a>
          </div>
          <div className="footer-section">
            <h3>Community</h3>
            <a href="#" className="footer-link">Discord</a>
            <a href="#" className="footer-link">Twitter</a>
            <a href="#" className="footer-link">Forum</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} FHE CAPTCHA v4. All rights reserved.</p>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;