// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PoWCaptchaFHE is SepoliaConfig {
    struct Challenge {
        uint256 challengeId;
        euint32 difficulty;
        euint32 clientNonce;
        euint32 solution;
        uint256 timestamp;
        bool verified;
    }

    uint256 public challengeCount;
    mapping(uint256 => Challenge) public challenges;
    mapping(address => uint256[]) public clientChallenges;
    mapping(bytes32 => bool) public usedSolutions;

    event ChallengeGenerated(uint256 indexed challengeId, uint256 timestamp);
    event SolutionSubmitted(uint256 indexed challengeId, uint256 timestamp);
    event VerificationCompleted(uint256 indexed challengeId, bool isValid);

    function generateChallenge(euint32 difficulty) external returns (uint256) {
        challengeCount++;
        uint256 newId = challengeCount;

        challenges[newId] = Challenge({
            challengeId: newId,
            difficulty: difficulty,
            clientNonce: FHE.asEuint32(0),
            solution: FHE.asEuint32(0),
            timestamp: block.timestamp,
            verified: false
        });

        emit ChallengeGenerated(newId, block.timestamp);
        return newId;
    }

    function submitSolution(
        uint256 challengeId,
        euint32 clientNonce,
        euint32 encryptedSolution
    ) external {
        require(challenges[challengeId].challengeId != 0, "Invalid challenge");
        require(!challenges[challengeId].verified, "Already verified");

        challenges[challengeId].clientNonce = clientNonce;
        challenges[challengeId].solution = encryptedSolution;
        challenges[challengeId].timestamp = block.timestamp;

        clientChallenges[msg.sender].push(challengeId);
        emit SolutionSubmitted(challengeId, block.timestamp);
    }

    function verifyChallenge(uint256 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.challengeId != 0, "Invalid challenge");
        require(!challenge.verified, "Already verified");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(challenge.difficulty);
        ciphertexts[1] = FHE.toBytes32(challenge.clientNonce);
        ciphertexts[2] = FHE.toBytes32(challenge.solution);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.checkSolution.selector);
    }

    function checkSolution(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) external {
        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint256 challengeId = requestId;
        Challenge storage challenge = challenges[challengeId];

        bytes32 solutionHash = keccak256(abi.encodePacked(
            results[0], // difficulty
            results[1], // clientNonce
            results[2]  // solution
        ));

        bool isValid = !usedSolutions[solutionHash] && 
                      results[2] % results[0] == 0;

        if (isValid) {
            usedSolutions[solutionHash] = true;
        }

        challenge.verified = true;
        emit VerificationCompleted(challengeId, isValid);
    }

    function getChallengeDifficulty(uint256 challengeId) external view returns (euint32) {
        return challenges[challengeId].difficulty;
    }

    function isChallengeVerified(uint256 challengeId) external view returns (bool) {
        return challenges[challengeId].verified;
    }

    function getClientChallenges(address client) external view returns (uint256[] memory) {
        return clientChallenges[client];
    }
}