
'use strict';

const tape = require('tape');
const _test = require('tape-promise').default;
const test = _test(tape);

const channelName = 'mychannel';
const chaincodeId = 'fabcar';

const FabricCAServices = require('fabric-ca-client');
const { Gateway, FileSystemWallet, HSMWalletMixin } = require('fabric-network');
const fs = require('fs-extra');

const ccp = fs.readFileSync('./network.json');

const IDManager = require('./idmanager');
const idManager = new IDManager();
idManager.initialize(JSON.parse(ccp.toString()));

const pkcsLibPath = '/usr/local/lib/softhsm/libsofthsm2.so';
const PKCS11_SLOT = process.env.PKCS11_SLOT || '0';
const PKCS11_PIN = process.env.PKCS11_PIN || '98765432';
const hsmUser = 'hsm-user11';

const path = require('path');
const walletPath = path.join(process.cwd(), 'wallet');
const hsmWallet = new FileSystemWallet(walletPath, new HSMWalletMixin(pkcsLibPath, PKCS11_SLOT, PKCS11_PIN));

async function setupAdmin() {
	if (!(await hsmWallet.exists('admin'))) {
		await idManager.enrollToWallet('admin', 'adminpw', 'Org1MSP', hsmWallet);
	}
}

async function hsmIdentitySetup() {
	if (!(await hsmWallet.exists(hsmUser))) {
		const secret = await idManager.registerUser(hsmUser, null, hsmWallet, 'admin');
		await idManager.enrollToWallet(hsmUser, secret, 'Org1MSP', hsmWallet);
	}
}

async function createContract(t, gateway, gatewayOptions) {
	await gateway.connect(JSON.parse(ccp.toString()), gatewayOptions);
	t.pass('Connected to the gateway');

	const network = await gateway.getNetwork(channelName);
	t.pass('Initialized the network, ' + channelName);

	const contract = network.getContract(chaincodeId);
	t.pass('Got the contract, about to submit "fabcar" transaction');

	return contract;
}

async function tlsEnroll() {
	return new Promise(((resolve, reject) => {
		const fabricCAEndpoint = 'https://tlsca.org1.example.com:9054';
		const tlsOptions = {
			trustedRoots: [],
			verify: false
		};
		const caService = new FabricCAServices(fabricCAEndpoint, tlsOptions, 'tlsca-org1');
		const req = {
			enrollmentID: 'admin',
			enrollmentSecret: 'adminpw',
			profile: 'tls'
		};
		caService.enroll(req).then(
			(enrollment) => {
				enrollment.key = enrollment.key.toBytes();
				return resolve(enrollment);
			},
			(err) => {
				return reject(err);
			}
		);
	}));
}

test('\n\n****** Network End-to-end flow: import identity into wallet using hsm *****\n\n', async (t) => {
	await setupAdmin();
	await hsmIdentitySetup();
	const exists = await hsmWallet.exists(hsmUser);
	if (exists) {
		t.pass('Successfully imported hsmUser into wallet');
	} else {
		t.fail('Failed to import hsmUser into wallet');
	}
	t.end();
});

test('\n\n***** Network End-to-end flow: invoke transaction to fabcar using file hsm wallet and default event strategy *****\n\n', async (t) => {
	const gateway = new Gateway();

	try {
		await setupAdmin();
		await hsmIdentitySetup();

		const tlsInfo = await tlsEnroll();
		const contract = await createContract(t, gateway, {
			wallet: hsmWallet,
			identity: hsmUser,
			tlsInfo,
			discovery: {enabled: true}
		});

		let response = await contract.submitTransaction('createCar', 'CAR25', 'Audi', 'A8', 'white', 'jk');

		const expectedResult = '';
		if (response.toString() === expectedResult) {
			t.pass('Successfully invoked transaction chaincode on channel');
		} else {
			t.fail('Unexpected response from transaction chaincode: ' + response);
		}

		response = await contract.evaluateTransaction('queryAllCars');
		t.comment('queryAllCars : ' + response.toString());

	} catch (err) {
		t.fail('Failed to invoke transaction chaincode on channel. ' + err.stack ? err.stack : err);
	} finally {
		gateway.disconnect();
	}
	t.end();
});
