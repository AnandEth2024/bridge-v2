/*
    Copyright (c) 2019 Mt Pelerin Group Ltd

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License version 3
    as published by the Free Software Foundation with the addition of the
    following permission added to Section 15 as permitted in Section 7(a):
    FOR ANY PART OF THE COVERED WORK IN WHICH THE COPYRIGHT IS OWNED BY
    MT PELERIN GROUP LTD. MT PELERIN GROUP LTD DISCLAIMS THE WARRANTY OF NON INFRINGEMENT
    OF THIRD PARTY RIGHTS

    This program is distributed in the hope that it will be useful, but
    WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE.
    See the GNU Affero General Public License for more details.
    You should have received a copy of the GNU Affero General Public License
    along with this program; if not, see http://www.gnu.org/licenses or write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA, 02110-1301 USA, or download the license from the following URL:
    https://www.gnu.org/licenses/agpl-3.0.fr.html

    The interactive user interfaces in modified source and object code versions
    of this program must display Appropriate Legal Notices, as required under
    Section 5 of the GNU Affero General Public License.

    You can be released from the requirements of the license by purchasing
    a commercial license. Buying such a license is mandatory as soon as you
    develop commercial activities involving Mt Pelerin Group Ltd software without
    disclosing the source code of your own applications.
    These activities include: offering paid services based/using this product to customers,
    using this product in any application, distributing this product with a closed
    source product.

    For more information, please contact Mt Pelerin Group Ltd at this
    address: hello@mtpelerin.com
*/

const chai = require('chai');
chai.use(require('chai-bignumber')());
require('chai/register-should');
const contract = require('../helpers/contract');
const { InMemorySigner } = require('@taquito/signer');
const { MichelsonMap } = require('@taquito/michelson-encoder');
global.TextEncoder = require('util').TextEncoder;
const { runOperation, tezosToolkit } = require('../helpers/toolkit');
const { shouldFail } = require('../helpers/shouldFail');
const { BURN_ADDRESS } = require('../helpers/constants');
const ContractBuilder = contract.ContractBuilder;

let tezos = tezosToolkit();

const timestamp = function (strDate) {
  return Math.floor(new Date(strDate).getTime()/1000);
};

contract('UserFreezeRule', function ([owner, token, trustedIntermediary1, trustedIntermediary2, address1, address2, address3, address4]) {
  beforeEach(async function () {
    tezos.setSignerProvider(new InMemorySigner(owner.sk));
    this.complianceRegistry = await ContractBuilder.new(tezos, 'ligo/operating/ComplianceRegistry.ligo', {}, { 
      owner: owner.pkh,
      roles: new MichelsonMap(),
      addressTransfers: new MichelsonMap(),
      addressUsers: new MichelsonMap(),
      trustedIntermediaries: new MichelsonMap(),
      userAttributes: new MichelsonMap(),
      userAddresses: new MichelsonMap(),
      onHoldTransfers: new MichelsonMap(),
    });
    this.callback = await ContractBuilder.new(tezos, 'ligo/mocks/RuleCallback.ligo', {}, {
      valid_: 0,
      reason_: 0,
    });
    this.ruleEngine = await ContractBuilder.new(tezos, 'ligo/mocks/RuleEngineCallback.ligo', {}, {
      valid_: 0,
      reason_: 0,
    });
    this.contract = await ContractBuilder.new(tezos, 'ligo/rules/UserFreezeRule.ligo', {}, {
      complianceRegistry: this.complianceRegistry.address,
      ruleEngine: this.ruleEngine.address,
      allowNotFound: 0,
    });
    this.nowContract = await ContractBuilder.new(tezos, 'ligo/mocks/NowCallback.ligo', {}, "1970-01-01T00:00:00.000Z");
    await runOperation(tezos, owner, () => this.nowContract.methods.default("").send());
    this.date = await this.nowContract.storage();
  });


  context('When no addresses are registered', function () {
    it('allows transfers if addresses are not found but allow not found is set', async function () {
      await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
      const result = await this.ruleEngine.storage();
      result.reason_.should.be.bignumber.equal('0');
      result.valid_.should.be.bignumber.equal('1');
    });

    it('rejects transfers if addresses are not found and allow not found is not set', async function () {
      await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 0, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
      const result = await this.ruleEngine.storage();
      result.reason_.should.be.bignumber.equal('2');
      result.valid_.should.be.bignumber.equal('0');
    });
  });

  context('When sender address is registered', function () {
    beforeEach(async function () {
      await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.registerUser(address1.pkh, [0, 100, 110, 111, 112], [1874872800, 1, 10000, 15000, 180000]).send());
    });

    it('allows transfers if receiver address is not found but allow not found is set', async function () {
      await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
      const result = await this.ruleEngine.storage();
      result.reason_.should.be.bignumber.equal('0');
      result.valid_.should.be.bignumber.equal('1');
    });

    it('rejects transfers if receiver address is not found and allow not found is not set', async function () {
      await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 0, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
      const result = await this.ruleEngine.storage();
      result.reason_.should.be.bignumber.equal('3');
      result.valid_.should.be.bignumber.equal('0');
    });

    context('Sender freezing', function () {
      it('approves transfers if sender is frozen for receive with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [1, start, end, 0], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('rejects transfers if sender is frozen for send with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [2, start, end, 0], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('2');
        result.valid_.should.be.bignumber.equal('0');
      });

      it('rejects transfers if sender is frozen for both sides with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 0], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('2');
        result.valid_.should.be.bignumber.equal('0');
      });

      it('approves transfers if sender is not frozen for receive with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [1, start, end, 1], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if sender is not frozen for send with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [2, start, end, 1], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if sender is not frozen for both sides with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 1], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if sender is not frozen anymore with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 7200);
        const end = '' + (timestamp(this.date) - 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 0], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('rejects transfers if sender is frozen with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 7200);
        const end = '' + (timestamp(this.date) - 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 1], 1).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('2');
        result.valid_.should.be.bignumber.equal('0');
      });
    });

    context('Receiver freezing', function () {
      beforeEach(async function () {
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.registerUser(address2.pkh, [0, 100, 110, 111, 112], [1874872800, 1, 10000, 15000, 180000]).send());
      });
      it('rejects transfers if receiver is frozen for receive with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [1, start, end, 0], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('3');
        result.valid_.should.be.bignumber.equal('0');
      });

      it('approves transfers if receiver is frozen for send with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [2, start, end, 0], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('rejects transfers if receiver is frozen for both sides with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 0], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('3');
        result.valid_.should.be.bignumber.equal('0');
      });

      it('approves transfers if receiver is not frozen for receive with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [1, start, end, 1], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if receiver is not frozen for send with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [2, start, end, 1], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if receiver is not frozen for both sides with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 3600);
        const end = '' + (timestamp(this.date) + 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 1], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('approves transfers if receiver is not frozen anymore with standard time frame', async function () {
        const start = '' + (timestamp(this.date) - 7200);
        const end = '' + (timestamp(this.date) - 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 0], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('0');
        result.valid_.should.be.bignumber.equal('1');
      });

      it('rejects transfers if receiver is frozen with inverted time frame', async function () {
        const start = '' + (timestamp(this.date) - 7200);
        const end = '' + (timestamp(this.date) - 3600);
        await runOperation(tezos, trustedIntermediary1, () => this.complianceRegistry.methods.updateUserAttributes([120, 121, 122, 123], [3, start, end, 1], 2).send());
        await runOperation(tezos, owner, () => this.contract.methods.isTransferValid(20000, 20000, this.callback.address, address1.pkh, BURN_ADDRESS, 1, address2.pkh, token.pkh, [trustedIntermediary1.pkh, trustedIntermediary2.pkh]).send());
        const result = await this.ruleEngine.storage();
        result.reason_.should.be.bignumber.equal('3');
        result.valid_.should.be.bignumber.equal('0');
      });
    });
  });
  
  context('Update after transfer', function () {
    it('should revert if trying to update', async function () {
      await shouldFail(runOperation(tezos, owner, () => this.contract.methods.afterTransferHook(10000, 10000, this.callback.address, address1.pkh, BURN_ADDRESS, 0, address2.pkh, token.pkh, []).send()), "RU02");
    });
  });
});